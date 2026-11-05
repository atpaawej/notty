import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  resolveVaultPaths,
  Vault,
  vaultMemoryLayer,
  vaultProductionLayer,
} from "./index";

const originalXdg = process.env.XDG_DATA_HOME;

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
});

describe("resolveVaultPaths", () => {
  it("honours XDG_DATA_HOME when set", () => {
    const paths = resolveVaultPaths("/tmp/xdg", "/home/test");
    expect(paths.root).toBe(join("/tmp/xdg", "notty", "vault"));
    expect(paths.attachments).toBe(join("/tmp/xdg", "notty", "vault", "attachments"));
    expect(paths.internal).toBe(join("/tmp/xdg", "notty", "vault", ".notty"));
  });

  it("falls back to ~/.local/share when unset", () => {
    const paths = resolveVaultPaths(undefined, "/home/test");
    expect(paths.root).toBe(join("/home/test", ".local", "share", "notty", "vault"));
  });

  it("treats a blank XDG_DATA_HOME as unset", () => {
    const paths = resolveVaultPaths("   ", "/home/test");
    expect(paths.root).toBe(join("/home/test", ".local", "share", "notty", "vault"));
  });
});

describe("Vault layer swapping", () => {
  const location = (layer: typeof vaultProductionLayer | typeof vaultMemoryLayer) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.location();
      }).pipe(Effect.provide(layer)),
    );

  it("production layer resolves from the environment", async () => {
    process.env.XDG_DATA_HOME = "/tmp/notty-xdg-test";
    const paths = await location(vaultProductionLayer);
    expect(paths.root).toBe(join("/tmp/notty-xdg-test", "notty", "vault"));
  });

  it("in-memory layer never touches the environment", async () => {
    process.env.XDG_DATA_HOME = "/tmp/notty-xdg-test";
    const paths = await location(vaultMemoryLayer);
    expect(paths.root).toBe("/notty-test-vault");
  });
});
