/**
 * Production adapter for the Tauri WebView.
 *
 * The location is resolved through `@tauri-apps/api/path` and every file
 * operation goes through `@tauri-apps/plugin-fs`, scoped to the vault root by
 * `src-tauri/capabilities/default.json`. This is the adapter the running app
 * composes in #6; Node never enters the browser bundle.
 */
import { dataDir } from "@tauri-apps/api/path";
import {
  exists,
  lstat,
  mkdir,
  readDir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import { Effect, Layer } from "effect";
import {
  resolveVaultPaths,
  Vault,
  VaultError,
  type VaultFileSystem,
  type VaultPaths,
} from "./service";
import { makeVault } from "./vault";

const tauriVaultFileSystem: VaultFileSystem = {
  exists: (path) => exists(path),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readDirectory: async (path) => {
    const entries = await readDir(path);
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory,
      isFile: entry.isFile,
    }));
  },
  stat: async (path) => {
    const info = await lstat(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      mtime: info.mtime,
    };
  },
  rename: (from, to) => rename(from, to),
  remove: async (path, options) => {
    await remove(path, { recursive: options?.recursive ?? false });
  },
};

const resolveTauriPaths = (): Effect.Effect<VaultPaths, VaultError> =>
  Effect.tryPromise({
    try: async () => {
      const data = await dataDir();
      return resolveVaultPaths(data, data);
    },
    catch: (cause) => new VaultError({ operation: "location", cause }),
  });

export const vaultTauriLayer = Layer.succeed(
  Vault,
  makeVault(resolveTauriPaths, tauriVaultFileSystem),
);
