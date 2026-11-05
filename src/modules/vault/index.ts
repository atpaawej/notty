/**
 * vault — owns the vault on disk.
 *
 * Public interface: the Vault service, its paths, and the composed Layers
 * used to wire the app. The implementation files in this folder are
 * private — import only from here.
 */
export { resolveVaultPaths, Vault } from "./service";
export type { VaultPaths, VaultShape } from "./service";
export { vaultProductionLayer } from "./fs-adapter";
export { vaultMemoryLayer } from "./memory-adapter";
