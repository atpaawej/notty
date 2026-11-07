/**
 * vault — owns the vault on disk.
 *
 * Public interface: the Vault service, its paths and typed error, and the
 * composed Layers used to wire each runtime. The implementation files in this
 * folder are private — import only from here.
 */
export { resolveVaultPaths, Vault, VaultError } from "./service";
export type { Attachment, AttachmentUpload, VaultPaths, VaultShape } from "./service";
export { vaultProductionLayer, vaultNodeLayer } from "./fs-adapter";
export { vaultMemoryLayer } from "./memory-adapter";
export { vaultTauriLayer } from "./tauri-adapter";
export {
  isWatchedVaultPath,
  mergeVaultChange,
  vaultRelativePath,
  WATCH_DEBOUNCE_MS,
} from "./watch";
export type {
  VaultChangeEvent,
  VaultChangeKind,
  VaultChangeListener,
  VaultWatcher,
} from "./watch";
export { watchVault, vaultChangeFromWatch } from "./tauri-watcher";
export { createMemoryVaultWatcher } from "./memory-watcher";
export type {
  MemoryVaultWatcher,
  MemoryVaultWatcherOptions,
} from "./memory-watcher";
