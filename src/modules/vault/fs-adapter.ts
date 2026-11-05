/**
 * Production adapter for Node runtimes (tests today, CLI tooling later).
 * Reads the environment at call time.
 *
 * Never import this file from browser code: the webview resolves the vault
 * location through Tauri commands (owned by the vault tickets), not through
 * Node builtins. If this module ever reaches the browser bundle, the build
 * fails loudly — keep it that way.
 */
import { Effect, Layer } from "effect";
import { resolveVaultPaths, Vault, type VaultFileSystem } from "./service";
import { makeVault } from "./vault";

/**
 * Node builtins load on first use, never when the WebView imports this
 * module's interface. The browser never calls these paths.
 */
const nodeVaultFileSystem: VaultFileSystem = {
  exists: async (path) => {
    const { access } = await import("node:fs/promises");
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  makeDirectory: async (path) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path, { recursive: true });
  },
  readDirectory: async (path) => {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  },
  stat: async (path) => {
    const { lstat } = await import("node:fs/promises");
    const info = await lstat(path);
    return {
      isFile: info.isFile(),
      isDirectory: info.isDirectory(),
      mtime: info.mtime,
    };
  },
  remove: async (path, options) => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { recursive: options?.recursive ?? false });
  },
};

export const vaultProductionLayer = Layer.succeed(
  Vault,
  makeVault(
    () =>
      Effect.promise(async () => {
        const { homedir } = await import("node:os");
        return resolveVaultPaths(process.env.XDG_DATA_HOME, homedir());
      }),
    nodeVaultFileSystem,
  ),
);
