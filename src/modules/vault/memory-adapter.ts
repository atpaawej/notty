/**
 * In-memory adapter for tests. Never touches the real home directory.
 */
import { Effect, Layer } from "effect";
import { Vault, type VaultPaths } from "./service";

const testPaths: VaultPaths = {
  root: "/notty-test-vault",
  attachments: "/notty-test-vault/attachments",
  internal: "/notty-test-vault/.notty",
};

export const vaultMemoryLayer = Layer.succeed(Vault, {
  location: () => Effect.succeed(testPaths),
});
