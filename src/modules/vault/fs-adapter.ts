/**
 * Production adapter for Node runtimes (tests today, CLI tooling later).
 * Reads the environment at call time.
 *
 * Never import this file from browser code: the webview resolves the vault
 * location through Tauri commands (owned by the vault tickets), not through
 * Node builtins. If this module ever reaches the browser bundle, the build
 * fails loudly — keep it that way.
 */
import { homedir } from "node:os";
import { Effect, Layer } from "effect";
import { resolveVaultPaths, Vault } from "./service";

export const vaultProductionLayer = Layer.succeed(Vault, {
  location: () =>
    Effect.sync(() => resolveVaultPaths(process.env.XDG_DATA_HOME, homedir())),
});
