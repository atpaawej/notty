/**
 * Private: the Vault service definition and pure path resolution.
 * Imported by the adapters and re-exported by ./index — never import this
 * file from outside the module.
 *
 * This file must stay dependency-free and I/O-free: it is shared by the
 * browser bundle, the test suite and (later) any Node tooling.
 */
import { Context, Data, type Effect } from "effect";

export interface VaultPaths {
  readonly root: string;
  readonly attachments: string;
  readonly internal: string;
  readonly trash: string;
}

/** POSIX join without node:path, so this module is bundle-safe. */
export const joinVaultPath = (base: string, ...segments: string[]): string =>
  [base.replace(/\/+$/, ""), ...segments].join("/").replace(/\/{2,}/g, "/");

/** Pure path resolution, exposed for tests. No I/O happens here. */
export const resolveVaultPaths = (
  xdgDataHome: string | undefined,
  home: string,
): VaultPaths => {
  const base =
    xdgDataHome && xdgDataHome.trim().length > 0
      ? xdgDataHome
      : joinVaultPath(home, ".local", "share");
  const root = joinVaultPath(base, "notty", "vault");
  return {
    root,
    attachments: joinVaultPath(root, "attachments"),
    internal: joinVaultPath(root, ".notty"),
    trash: joinVaultPath(root, ".trash"),
  };
};

/**
 * Vault operations fail with a typed error and never throw. The `operation`
 * names the interface method that failed; `path` is the entry it touched.
 */
export class VaultError extends Data.TaggedError("VaultError")<{
  readonly operation: string;
  readonly path?: string;
  readonly cause: unknown;
}> {}

export interface DirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

export interface VaultFileInfo {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly mtime: Date | null;
}

/** Bytes handed to the vault for storage as an attachment. */
export interface AttachmentUpload {
  readonly bytes: Uint8Array;
  /** Original filename. Its extension and name are kept for the note. */
  readonly name: string;
  /** Used to infer an extension when the name does not carry one. */
  readonly mimeType?: string;
}

/** A stored attachment: where it lives and what to call it in a note. */
export interface Attachment {
  /** Vault-relative POSIX path, e.g. `attachments/<uuid>.png`. */
  readonly path: string;
  /** The original filename, suitable as default alt text. */
  readonly name: string;
}

/**
 * The filesystem seam behind the Vault service. Each runtime adapter supplies
 * its own implementation; the retention logic itself lives in vault.ts so it
 * is written and tested once.
 */
export interface VaultFileSystem {
  readonly exists: (path: string) => Promise<boolean>;
  readonly makeDirectory: (path: string) => Promise<void>;
  readonly readDirectory: (path: string) => Promise<ReadonlyArray<DirectoryEntry>>;
  readonly stat: (path: string) => Promise<VaultFileInfo>;
  readonly writeFile: (path: string, contents: Uint8Array) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly remove: (
    path: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<void>;
}

export type VaultResolvePaths = () => Effect.Effect<VaultPaths, VaultError>;

export interface VaultShape {
  readonly location: () => Effect.Effect<VaultPaths, VaultError>;
  readonly ensure: () => Effect.Effect<void, VaultError>;
  readonly sweepTrash: (now?: Date) => Effect.Effect<number, VaultError>;
  /**
   * Every visible folder as a vault-relative POSIX path, sorted. Hidden
   * directories and the attachments directory are not folders in the UI.
   */
  readonly listFolders: () => Effect.Effect<ReadonlyArray<string>, VaultError>;
  /** Create a folder (and its parents). Returns the normalized path. */
  readonly createFolder: (folder: string) => Effect.Effect<string, VaultError>;
  /** Rename/move a folder subtree. Returns the normalized destination. */
  readonly renameFolder: (
    folder: string,
    nextFolder: string,
  ) => Effect.Effect<string, VaultError>;
  /** Remove a folder and everything beneath it. */
  readonly deleteFolder: (folder: string) => Effect.Effect<void, VaultError>;
  /**
   * Write image bytes to the vault-level attachments directory under a UUID
   * filename. The returned path is what a note body references.
   */
  readonly saveAttachment: (
    upload: AttachmentUpload,
  ) => Effect.Effect<Attachment, VaultError>;
}

export class Vault extends Context.Service<Vault, VaultShape>()("notty/Vault") {}
