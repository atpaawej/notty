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
  };
};
