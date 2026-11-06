/**
 * In-memory adapter for tests. Never touches the real home directory.
 *
 * The filesystem seam is backed by a map, so `ensure` and `sweepTrash` behave
 * like the real adapters without any I/O.
 */
import { Effect, Layer } from "effect";
import { Vault, type VaultFileSystem, type VaultPaths } from "./service";
import { makeVault } from "./vault";

const testPaths: VaultPaths = {
  root: "/notty-test-vault",
  attachments: "/notty-test-vault/attachments",
  internal: "/notty-test-vault/.notty",
  trash: "/notty-test-vault/.trash",
};

interface MemoryEntry {
  readonly kind: "file" | "directory";
  readonly mtime: Date | null;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const createMemoryFileSystem = (): VaultFileSystem => {
  const entries = new Map<string, MemoryEntry>();

  const removeEntry = (path: string): void => {
    for (const key of [...entries.keys()]) {
      if (key.startsWith(`${path}/`)) entries.delete(key);
    }
    entries.delete(path);
  };

  return {
    exists: async (path) => entries.has(path),
    makeDirectory: async (path) => {
      const segments = path.split("/").filter(Boolean);
      let current = "";
      for (const segment of segments) {
        current = `${current}/${segment}`;
        const entry = entries.get(current);
        if (entry === undefined) {
          entries.set(current, { kind: "directory", mtime: null });
        } else if (entry.kind !== "directory") {
          throw new Error(`Not a directory: ${current}`);
        }
      }
    },
    readDirectory: async (path) => {
      const prefix = path === "/" ? "/" : `${path}/`;
      const result = [];
      for (const [key, entry] of entries) {
        if (!key.startsWith(prefix)) continue;
        if (key.slice(prefix.length).includes("/")) continue;
        result.push({
          name: nameOf(key),
          isDirectory: entry.kind === "directory",
          isFile: entry.kind === "file",
        });
      }
      return result;
    },
    stat: async (path) => {
      const entry = entries.get(path);
      if (entry === undefined) throw new Error(`No such entry: ${path}`);
      return {
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "directory",
        mtime: entry.mtime,
      };
    },
    rename: async (from, to) => {
      const entry = entries.get(from);
      if (entry === undefined) throw new Error(`No such entry: ${from}`);
      if (entries.has(to)) throw new Error(`Entry already exists: ${to}`);
      const moved = [...entries.entries()].filter(
        ([key]) => key === from || key.startsWith(`${from}/`),
      );
      for (const [key] of moved) entries.delete(key);
      for (const [key, value] of moved) {
        const next = key === from ? to : `${to}${key.slice(from.length)}`;
        entries.set(next, value);
      }
    },
    remove: async (path, options) => {
      const entry = entries.get(path);
      if (entry === undefined) throw new Error(`No such entry: ${path}`);
      const hasChildren = [...entries.keys()].some((key) =>
        key.startsWith(`${path}/`),
      );
      if (entry.kind === "directory" && hasChildren && !options?.recursive) {
        throw new Error(`Directory not empty: ${path}`);
      }
      removeEntry(path);
    },
  };
};

export const vaultMemoryLayer = Layer.succeed(
  Vault,
  makeVault(() => Effect.succeed(testPaths), createMemoryFileSystem()),
);
