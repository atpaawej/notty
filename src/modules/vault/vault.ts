/**
 * Private: the adapter-independent Vault behaviour.
 *
 * The retention sweep and directory setup are written once here and handed a
 * filesystem seam. Node, Tauri and in-memory adapters differ only in that
 * seam, so the Trash contract cannot drift between runtimes.
 */
import { Effect } from "effect";
import {
  joinVaultPath,
  VaultError,
  type VaultFileSystem,
  type VaultResolvePaths,
  type VaultShape,
} from "./service";

/** Trashed notes are restorable for this long, then permanently deleted. */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;
const MARKDOWN_SUFFIX = ".md";
const ATTACHMENTS_DIRECTORY = "attachments";

interface WalkResult {
  readonly removed: number;
  /** Entries left behind in this directory after the sweep. */
  readonly remaining: number;
}

export const makeVault = (
  resolvePaths: VaultResolvePaths,
  fs: VaultFileSystem,
): VaultShape => {
  const attempt = <A>(
    operation: string,
    path: string,
    run: () => Promise<A>,
  ): Effect.Effect<A, VaultError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new VaultError({ operation, path, cause }),
    });

  const ensure = (): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const paths = yield* resolvePaths();
      for (const path of [
        paths.root,
        paths.attachments,
        paths.internal,
        paths.trash,
      ]) {
        yield* attempt("ensure", path, () => fs.makeDirectory(path));
      }
    });

  /**
   * Folders are vault-relative POSIX paths. The sidebar only shows folders
   * that `listFolders` would list, so hidden names cannot be created here.
   */
  const normalizeFolder = (
    operation: string,
    folder: string,
  ): Effect.Effect<string, VaultError> => {
    const trimmed = folder.trim();
    const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("/") ||
      trimmed.includes("\\") ||
      segments.length === 0 ||
      segments.some((segment) => segment === ".." || segment.startsWith("."))
    ) {
      return Effect.fail(
        new VaultError({
          operation,
          path: folder,
          cause: new Error(`Folder must be a visible vault-relative POSIX path: ${folder}`),
        }),
      );
    }
    return Effect.succeed(segments.join("/"));
  };

  const absolutePath = (root: string, relativePath: string): string =>
    relativePath.length === 0 ? root : `${root}/${relativePath}`;

  const parentOf = (folder: string): string => {
    const slash = folder.lastIndexOf("/");
    return slash < 0 ? "" : folder.slice(0, slash);
  };

  const listFolders = (): Effect.Effect<ReadonlyArray<string>, VaultError> =>
    Effect.gen(function* () {
      const paths = yield* resolvePaths();
      const folders: string[] = [];

      const walk = (relative: string): Effect.Effect<void, VaultError> =>
        Effect.gen(function* () {
          const directory = absolutePath(paths.root, relative);
          const entries = yield* attempt("listFolders", directory, () =>
            fs.readDirectory(directory),
          );
          for (const entry of entries) {
            if (!entry.isDirectory || entry.name.startsWith(".")) continue;
            if (relative.length === 0 && entry.name === ATTACHMENTS_DIRECTORY) {
              continue;
            }
            const child = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
            folders.push(child);
            yield* walk(child);
          }
        });

      yield* walk("");
      return folders.sort((left, right) => left.localeCompare(right));
    });

  const createFolder = (folder: string): Effect.Effect<string, VaultError> =>
    Effect.gen(function* () {
      const paths = yield* resolvePaths();
      const normalized = yield* normalizeFolder("createFolder", folder);
      const path = absolutePath(paths.root, normalized);
      yield* attempt("createFolder", path, () => fs.makeDirectory(path));
      return normalized;
    });

  const renameFolder = (
    folder: string,
    nextFolder: string,
  ): Effect.Effect<string, VaultError> =>
    Effect.gen(function* () {
      const paths = yield* resolvePaths();
      const sourceRelative = yield* normalizeFolder("renameFolder", folder);
      const targetRelative = yield* normalizeFolder("renameFolder", nextFolder);
      if (sourceRelative === targetRelative) return targetRelative;

      const source = absolutePath(paths.root, sourceRelative);
      const target = absolutePath(paths.root, targetRelative);

      const info = yield* attempt("renameFolder", source, () => fs.stat(source));
      if (!info.isDirectory) {
        return yield* Effect.fail(
          new VaultError({
            operation: "renameFolder",
            path: source,
            cause: new Error(`Not a folder: ${source}`),
          }),
        );
      }

      const targetExists = yield* attempt("renameFolder", target, () =>
        fs.exists(target),
      );
      if (targetExists) {
        return yield* Effect.fail(
          new VaultError({
            operation: "renameFolder",
            path: target,
            cause: new Error(`Folder already exists: ${target}`),
          }),
        );
      }

      const parent = parentOf(targetRelative);
      if (parent.length > 0) {
        yield* attempt("renameFolder", absolutePath(paths.root, parent), () =>
          fs.makeDirectory(absolutePath(paths.root, parent)),
        );
      }
      yield* attempt("renameFolder", source, () => fs.rename(source, target));
      return targetRelative;
    });

  const deleteFolder = (folder: string): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const paths = yield* resolvePaths();
      const normalized = yield* normalizeFolder("deleteFolder", folder);
      const path = absolutePath(paths.root, normalized);
      yield* attempt("deleteFolder", path, () =>
        fs.remove(path, { recursive: true }),
      );
    });

  const sweepDirectory = (
    path: string,
    cutoff: number,
  ): Effect.Effect<WalkResult, VaultError> =>
    Effect.gen(function* () {
      const entries = yield* attempt("sweepTrash", path, () =>
        fs.readDirectory(path),
      );
      let removed = 0;
      let remaining = 0;

      for (const entry of entries) {
        const entryPath = joinVaultPath(path, entry.name);

        if (entry.isDirectory) {
          const child = yield* sweepDirectory(entryPath, cutoff);
          removed += child.removed;
          if (child.remaining === 0) {
            yield* attempt("sweepTrash", entryPath, () =>
              fs.remove(entryPath, { recursive: true }),
            );
          } else {
            remaining += 1;
          }
          continue;
        }

        if (entry.isFile && entry.name.endsWith(MARKDOWN_SUFFIX)) {
          const info = yield* attempt("sweepTrash", entryPath, () =>
            fs.stat(entryPath),
          );
          // Strictly older than the retention window: 30 days exactly is kept.
          if (info.mtime !== null && info.mtime.getTime() < cutoff) {
            yield* attempt("sweepTrash", entryPath, () => fs.remove(entryPath));
            removed += 1;
          } else {
            remaining += 1;
          }
          continue;
        }

        // Non-Markdown files and symlinks are left alone.
        remaining += 1;
      }

      return { removed, remaining };
    });

  const sweepTrash = (now: Date = new Date()): Effect.Effect<number, VaultError> =>
    Effect.gen(function* () {
      const paths = yield* resolvePaths();
      const present = yield* attempt("sweepTrash", paths.trash, () =>
        fs.exists(paths.trash),
      );
      if (!present) return 0;

      const cutoff = now.getTime() - TRASH_RETENTION_MS;
      const result = yield* sweepDirectory(paths.trash, cutoff);
      return result.removed;
    });

  return {
    location: resolvePaths,
    ensure,
    sweepTrash,
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
  };
};
