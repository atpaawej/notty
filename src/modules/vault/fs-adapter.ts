/**
 * Production adapter for Node runtimes (tests today, CLI tooling later).
 * Reads the environment at call time.
 *
 * Never import this file from browser code: the webview resolves the vault
 * location through Tauri commands (owned by the vault tickets), not through
 * Node builtins. If this module ever reaches the browser bundle, the build
 * fails loudly — keep it that way.
 */
import { access, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { Effect, Layer } from "effect";
import { resolveVaultPaths, Vault, type VaultFileSystem } from "./service";
import { makeVault } from "./vault";

const nodeVaultFileSystem: VaultFileSystem = {
  exists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readDirectory: async (path) => {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  },
  stat: async (path) => {
    const info = await lstat(path);
    return {
      isFile: info.isFile(),
      isDirectory: info.isDirectory(),
      mtime: info.mtime,
    };
  },
  remove: async (path, options) => {
    await rm(path, { recursive: options?.recursive ?? false });
  },
};

export const vaultProductionLayer = Layer.succeed(
  Vault,
  makeVault(
    () =>
      Effect.sync(() =>
        resolveVaultPaths(process.env.XDG_DATA_HOME, homedir()),
      ),
    nodeVaultFileSystem,
  ),
);
