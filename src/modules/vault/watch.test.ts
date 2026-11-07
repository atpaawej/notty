import { describe, expect, it, vi } from "vitest";
import {
  createMemoryVaultWatcher,
  isWatchedVaultPath,
  vaultChangeFromWatch,
  vaultRelativePath,
  type VaultChangeEvent,
} from "./index";

describe("vault path filter", () => {
  it("watches Markdown notes and visible folders only", () => {
    expect(isWatchedVaultPath("note.md")).toBe(true);
    expect(isWatchedVaultPath("Work/projects.md")).toBe(true);
    expect(isWatchedVaultPath("Work", true)).toBe(true);
  });

  it("rejects internal directories, attachments, database files and non-Markdown", () => {
    for (const path of [
      ".notty/welcome-notes-seeded",
      ".trash/note.md",
      "attachments/receipt.png",
      "notty.db",
      "notty.db-wal",
      "notes.txt",
      "Work/.note.md.swp",
      ".hidden.md",
    ]) {
      expect(isWatchedVaultPath(path)).toBe(false);
    }
  });

  it("turns absolute event paths into vault-relative ones", () => {
    expect(vaultRelativePath("/vault", "/vault/Work/note.md")).toBe(
      "Work/note.md",
    );
    expect(vaultRelativePath("/vault/", "/vault/note.md")).toBe("note.md");
    expect(vaultRelativePath("/vault", "Work/note.md")).toBe("Work/note.md");
    expect(vaultRelativePath("/vault", "/other/note.md")).toBeNull();
  });

  it("classifies native create, modify and remove events", () => {
    expect(
      vaultChangeFromWatch("/vault", { create: { kind: "file" } }, "/vault/a.md"),
    ).toEqual({ kind: "create", path: "a.md" });
    expect(
      vaultChangeFromWatch("/vault", "any", "/vault/a.md"),
    ).toEqual({ kind: "update", path: "a.md" });
    expect(
      vaultChangeFromWatch("/vault", { remove: { kind: "file" } }, "/vault/a.md"),
    ).toEqual({ kind: "remove", path: "a.md" });
    expect(
      vaultChangeFromWatch("/vault", { create: { kind: "folder" } }, "/vault/Work"),
    ).toEqual({ kind: "create", path: "Work", isDirectory: true });
  });
});

describe("in-memory watcher adapter", () => {
  const events = (): {
    received: VaultChangeEvent[];
    listener: (event: VaultChangeEvent) => void;
  } => {
    const received: VaultChangeEvent[] = [];
    return {
      received,
      listener: (event) => {
        received.push(event);
      },
    };
  };

  it("propagates a Markdown change to every listener", async () => {
    const watcher = createMemoryVaultWatcher();
    const first = events();
    const second = events();
    await watcher.watch("/vault", first.listener);
    await watcher.watch("/vault", second.listener);

    watcher.emit({ kind: "create", path: "Work/note.md" });

    expect(first.received).toEqual([
      { kind: "create", path: "Work/note.md" },
    ]);
    expect(second.received).toEqual(first.received);
  });

  it("drops internal and non-note paths before listeners see them", async () => {
    const watcher = createMemoryVaultWatcher();
    const { received, listener } = events();
    await watcher.watch("/vault", listener);

    watcher.emitPath("/vault/.trash/note.md", "create");
    watcher.emitPath("/vault/.notty/welcome-notes-seeded", "create");
    watcher.emitPath("/vault/attachments/image.png", "create");
    watcher.emitPath("/vault/notty.db-wal", "update");
    watcher.emitPath("/vault/note.txt", "update");
    watcher.emitPath("/vault/Work/note.md", "create");

    expect(received).toEqual([{ kind: "create", path: "Work/note.md" }]);
  });

  it("reports visible folder changes without confusing them for notes", async () => {
    const watcher = createMemoryVaultWatcher();
    const { received, listener } = events();
    await watcher.watch("/vault", listener);

    watcher.emitPath("/vault/Work", "create", true);

    expect(received).toEqual([
      { kind: "create", path: "Work", isDirectory: true },
    ]);
  });

  it("stops delivering after the returned unwatch function runs", async () => {
    const watcher = createMemoryVaultWatcher();
    const { received, listener } = events();
    const stop = await watcher.watch("/vault", listener);

    watcher.emit({ kind: "update", path: "note.md" });
    stop();
    watcher.emit({ kind: "update", path: "note.md" });

    expect(received).toHaveLength(1);
  });

  it("bundles a burst into one event per path when debounced", async () => {
    vi.useFakeTimers();
    try {
      const watcher = createMemoryVaultWatcher({ debounceMs: 50 });
      const { received, listener } = events();
      await watcher.watch("/vault", listener);

      watcher.emit({ kind: "update", path: "a.md" });
      watcher.emit({ kind: "update", path: "a.md" });
      watcher.emit({ kind: "create", path: "b.md" });
      expect(received).toEqual([]);

      await vi.advanceTimersByTimeAsync(50);
      expect(received).toEqual([
        { kind: "update", path: "a.md" },
        { kind: "create", path: "b.md" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
