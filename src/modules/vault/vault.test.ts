import { access, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  resolveVaultPaths,
  Vault,
  vaultMemoryLayer,
  vaultProductionLayer,
  type VaultPaths,
  type VaultShape,
} from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.UTC(2026, 10, 5, 12, 0, 0));

const originalXdg = process.env.XDG_DATA_HOME;
let tempHome: string;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "notty-vault-"));
  process.env.XDG_DATA_HOME = tempHome;
});

afterEach(async () => {
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  await rm(tempHome, { recursive: true, force: true });
});

const withVault = <A, E>(
  run: (vault: VaultShape) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault;
      return yield* run(vault);
    }).pipe(Effect.provide(vaultProductionLayer)),
  );

const ensureVault = (): Promise<VaultPaths> =>
  withVault((vault) =>
    Effect.gen(function* () {
      yield* vault.ensure();
      return yield* vault.location();
    }),
  );

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const trashEntry = async (
  paths: VaultPaths,
  relativePath: string,
  mtime: Date,
): Promise<string> => {
  const fullPath = join(paths.trash, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, "note body");
  await utimes(fullPath, mtime, mtime);
  return fullPath;
};

const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * DAY_MS);

describe("resolveVaultPaths", () => {
  it("honours XDG_DATA_HOME when set", () => {
    const paths = resolveVaultPaths("/tmp/xdg", "/home/test");
    expect(paths.root).toBe(join("/tmp/xdg", "notty", "vault"));
    expect(paths.attachments).toBe(join("/tmp/xdg", "notty", "vault", "attachments"));
    expect(paths.internal).toBe(join("/tmp/xdg", "notty", "vault", ".notty"));
    expect(paths.trash).toBe(join("/tmp/xdg", "notty", "vault", ".trash"));
  });

  it("falls back to ~/.local/share when unset", () => {
    const paths = resolveVaultPaths(undefined, "/home/test");
    expect(paths.root).toBe(join("/home/test", ".local", "share", "notty", "vault"));
    expect(paths.trash).toBe(join(paths.root, ".trash"));
  });

  it("treats a blank XDG_DATA_HOME as unset", () => {
    const paths = resolveVaultPaths("   ", "/home/test");
    expect(paths.root).toBe(join("/home/test", ".local", "share", "notty", "vault"));
  });
});

describe("Vault.ensure", () => {
  it("creates the conventional XDG vault and all four directories", async () => {
    const paths = await ensureVault();

    expect(paths.root).toBe(join(tempHome, "notty", "vault"));
    expect(paths.attachments).toBe(join(paths.root, "attachments"));
    expect(paths.internal).toBe(join(paths.root, ".notty"));
    expect(paths.trash).toBe(join(paths.root, ".trash"));

    for (const path of [
      paths.root,
      paths.attachments,
      paths.internal,
      paths.trash,
    ]) {
      expect((await stat(path)).isDirectory()).toBe(true);
    }
  });

  it("is idempotent when the vault already exists", async () => {
    const paths = await ensureVault();

    await expect(withVault((vault) => vault.ensure())).resolves.toBeUndefined();

    expect((await stat(paths.root)).isDirectory()).toBe(true);
    expect((await stat(paths.trash)).isDirectory()).toBe(true);
  });
});

describe("Vault.sweepTrash", () => {
  it("returns zero when Trash has not been created yet", async () => {
    const removed = await withVault((vault) => vault.sweepTrash(NOW));
    expect(removed).toBe(0);
  });

  it("keeps 29 and 30 day old notes and deletes 31 day old notes", async () => {
    const paths = await ensureVault();
    const fresh = await trashEntry(paths, "fresh.md", daysAgo(1));
    const kept29 = await trashEntry(paths, "kept-29.md", daysAgo(29));
    const kept30 = await trashEntry(paths, "kept-30.md", daysAgo(30));
    const expired = await trashEntry(paths, "expired.md", daysAgo(31));

    const removed = await withVault((vault) => vault.sweepTrash(NOW));

    expect(removed).toBe(1);
    expect(await fileExists(fresh)).toBe(true);
    expect(await fileExists(kept29)).toBe(true);
    expect(await fileExists(kept30)).toBe(true);
    expect(await fileExists(expired)).toBe(false);
  });

  it("deletes every expired Markdown note and counts them", async () => {
    const paths = await ensureVault();
    await trashEntry(paths, "one.md", daysAgo(40));
    await trashEntry(paths, "two.md", daysAgo(31));
    const kept = await trashEntry(paths, "three.md", daysAgo(29));

    const removed = await withVault((vault) => vault.sweepTrash(NOW));

    expect(removed).toBe(2);
    expect(await fileExists(kept)).toBe(true);
  });

  it("leaves non-Markdown files alone even when they are expired", async () => {
    const paths = await ensureVault();
    const image = await trashEntry(paths, "receipt.png", daysAgo(90));
    const note = await trashEntry(paths, "note.md", daysAgo(90));

    const removed = await withVault((vault) => vault.sweepTrash(NOW));

    expect(removed).toBe(1);
    expect(await fileExists(image)).toBe(true);
    expect(await fileExists(note)).toBe(false);
  });

  it("walks nested Trash entries that mirror their original folders", async () => {
    const paths = await ensureVault();
    const expired = await trashEntry(
      paths,
      "Work/Projects/expired.md",
      daysAgo(31),
    );
    const kept = await trashEntry(paths, "Work/Projects/kept.md", daysAgo(30));
    const other = await trashEntry(paths, "Work/kept-too.md", daysAgo(29));

    const removed = await withVault((vault) => vault.sweepTrash(NOW));

    expect(removed).toBe(1);
    expect(await fileExists(expired)).toBe(false);
    expect(await fileExists(kept)).toBe(true);
    expect(await fileExists(other)).toBe(true);
  });

  it("prunes nested directories that the sweep empties", async () => {
    const paths = await ensureVault();
    await trashEntry(paths, "Archive/2020/only.md", daysAgo(45));
    const archive = join(paths.trash, "Archive");

    const removed = await withVault((vault) => vault.sweepTrash(NOW));

    expect(removed).toBe(1);
    expect(await fileExists(archive)).toBe(false);
  });
});

describe("Vault layer swapping", () => {
  it("production layer resolves from the environment", async () => {
    const paths = await withVault((vault) => vault.location());
    expect(paths.root).toBe(join(tempHome, "notty", "vault"));
  });

  it("in-memory layer never touches the environment", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const vault = yield* Vault;
        const paths = yield* vault.location();
        yield* vault.ensure();
        const removed = yield* vault.sweepTrash(NOW);
        return { paths, removed };
      }).pipe(Effect.provide(vaultMemoryLayer)),
    );

    expect(result.paths.root).toBe("/notty-test-vault");
    expect(result.paths.trash).toBe("/notty-test-vault/.trash");
    expect(result.removed).toBe(0);
  });
});

describe("Vault folders", () => {
  it("creates nested folders and lists the visible tree", async () => {
    const paths = await ensureVault();

    await withVault((vault) => vault.createFolder("Work/Projects"));
    await mkdir(join(paths.root, ".secret"), { recursive: true });

    await expect(withVault((vault) => vault.listFolders())).resolves.toEqual([
      "Work",
      "Work/Projects",
    ]);
    expect(await fileExists(join(paths.root, "Work", "Projects"))).toBe(true);
  });

  it("renames a folder subtree and keeps the note files inside", async () => {
    const paths = await ensureVault();
    await withVault((vault) => vault.createFolder("Work"));
    await writeFile(join(paths.root, "Work", "note.md"), "body");

    await expect(
      withVault((vault) => vault.renameFolder("Work", "Office")),
    ).resolves.toBe("Office");

    expect(await fileExists(join(paths.root, "Work"))).toBe(false);
    expect(await fileExists(join(paths.root, "Office", "note.md"))).toBe(true);
    await expect(withVault((vault) => vault.listFolders())).resolves.toEqual([
      "Office",
    ]);
  });

  it("deletes a folder and everything beneath it", async () => {
    const paths = await ensureVault();
    await withVault((vault) => vault.createFolder("Work/Projects"));
    await writeFile(join(paths.root, "Work", "Projects", "note.md"), "body");

    await withVault((vault) => vault.deleteFolder("Work"));

    expect(await fileExists(join(paths.root, "Work"))).toBe(false);
    await expect(withVault((vault) => vault.listFolders())).resolves.toEqual([]);
  });

  it("refuses folder paths that escape the vault or hide from the sidebar", async () => {
    await ensureVault();

    await expect(
      withVault((vault) => vault.createFolder("../outside")),
    ).rejects.toBeDefined();
    await expect(
      withVault((vault) => vault.createFolder(".notty")),
    ).rejects.toBeDefined();
  });

  it("supports the same folder lifecycle in the in-memory adapter", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const vault = yield* Vault;
        yield* vault.createFolder("Work");
        const created = yield* vault.listFolders();
        yield* vault.renameFolder("Work", "Office");
        const renamed = yield* vault.listFolders();
        yield* vault.deleteFolder("Office");
        const deleted = yield* vault.listFolders();
        return { created, renamed, deleted };
      }).pipe(Effect.provide(vaultMemoryLayer)),
    );

    expect(result.created).toEqual(["Work"]);
    expect(result.renamed).toEqual(["Office"]);
    expect(result.deleted).toEqual([]);
  });
});

