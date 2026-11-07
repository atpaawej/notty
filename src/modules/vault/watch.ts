/**
 * Private: the vault watcher seam and the pure path filter both adapters use.
 *
 * The watcher reports vault-relative Markdown changes. Everything the app
 * cares about — accidental re-indexing of internal files, temp dotfiles,
 * database writes — is decided here, once, so the Tauri and in-memory
 * adapters cannot drift.
 */

/** What happened to a watched vault entry. */
export type VaultChangeKind = "create" | "update" | "remove";

export interface VaultChangeEvent {
  readonly kind: VaultChangeKind;
  /** Vault-relative POSIX path. Never absolute, never contains `..`. */
  readonly path: string;
  /**
   * True for a visible folder change. The workspace refreshes its tree for
   * these; the index ignores them because notes live in files.
   */
  readonly isDirectory?: boolean;
}

export type VaultChangeListener = (
  event: VaultChangeEvent,
) => Promise<void> | void;

/**
 * The seam behind realtime vault synchronization. Production watches the OS;
 * the in-memory adapter lets tests emit changes deterministically.
 */
export interface VaultWatcher {
  /**
   * Start watching one vault root. Resolves with the function that stops the
   * watch; callers own its lifetime.
   */
  readonly watch: (
    vaultRoot: string,
    onChange: VaultChangeListener,
  ) => Promise<() => void>;
}

/** Trailing debounce that bundles a burst of filesystem events. */
export const WATCH_DEBOUNCE_MS = 50;

const ATTACHMENTS_DIRECTORY = "attachments";
const DATABASE_PREFIX = "notty.db";

const normalizeSlashes = (path: string): string => path.replace(/\\/g, "/");

const trimTrailingSlashes = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/** Strip a vault root from an absolute event path, or accept a relative one. */
export const vaultRelativePath = (
  vaultRoot: string,
  path: string,
): string | null => {
  const root = trimTrailingSlashes(normalizeSlashes(vaultRoot));
  const candidate = trimTrailingSlashes(normalizeSlashes(path));

  if (candidate === root) return "";
  if (candidate.startsWith(`${root}/`)) {
    return candidate.slice(root.length + 1);
  }
  if (candidate.startsWith("/")) return null;
  return candidate.replace(/^\.\/+/, "");
};

/**
 * True when a vault-relative path is user note content. Internal directories,
 * the attachments directory, database files and temporary dotfiles are all
 * invisible to the watcher.
 */
export const isWatchedVaultPath = (
  relativePath: string,
  isDirectory = false,
): boolean => {
  const path = relativePath.replace(/^\/+|\/+$/g, "");
  if (path.length === 0) return false;

  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return false;

  // `.notty`, `.trash` and editor temp files such as `.note.md.swp`.
  if (segments.some((segment) => segment.startsWith("."))) return false;

  if (segments[0] === ATTACHMENTS_DIRECTORY) return false;

  const basename = segments[segments.length - 1] ?? "";
  if (basename.startsWith(DATABASE_PREFIX)) return false;

  return isDirectory || basename.toLowerCase().endsWith(".md");
};

/** Fold two events for the same path so a burst costs one reconcile. */
export const mergeVaultChange = (
  previous: VaultChangeEvent | undefined,
  next: VaultChangeEvent,
): VaultChangeEvent => {
  if (previous === undefined) return next;
  // A rename is reported as remove-then-create; the later create wins. Two
  // modifies remain a modify. A remove after a create (atomic save) wins.
  if (next.kind === "remove") return next;
  if (previous.kind === "remove" && next.kind === "create") return next;
  return next;
};
