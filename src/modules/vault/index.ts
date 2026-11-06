/**
 * vault — owns the vault on disk.
 *
 * Public interface: the Vault service, its paths and typed error, and the
 * composed Layers used to wire each runtime. The implementation files in this
 * folder are private — import only from here.
 */
export { resolveVaultPaths, Vault, VaultError } from "./service";
export type { Attachment, AttachmentUpload, VaultPaths, VaultShape } from "./service";
export { vaultProductionLayer } from "./fs-adapter";
export { vaultMemoryLayer } from "./memory-adapter";
export { vaultTauriLayer } from "./tauri-adapter";
