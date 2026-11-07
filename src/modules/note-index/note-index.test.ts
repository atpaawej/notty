import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Exit, type Layer } from "effect";
import { serialize, type Note } from "../note-file";
import {
  NoteIndex,
  noteIndexMemoryLayer,
  noteIndexNodeLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "./index";

const makeNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: `Title ${id}`,
  created: "2026-11-05T09:00:00Z",
  modified: "2026-11-05T09:00:00Z",
  pinned: false,
  archived: false,
  body: `Body ${id}`,
  ...overrides,
});

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "notty-index-"));
});

afterEach(async () => {
  await rm(vaultRoot, { recursive: true, force: true });
});

const withIndex = <A>(
  layer: Layer.Layer<NoteIndex, NoteIndexError>,
  run: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return yield* run(index);
    }).pipe(Effect.provide(layer)),
  );

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const writeNoteFile = async (relativePath: string, note: Note): Promise<void> => {
  const path = join(vaultRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialize(note));
};

const adapters = [
  {
    name: "file-backed SQLite",
    layer: (root: string) => noteIndexNodeLayer({ root }),
  },
  {
    name: "in-memory SQLite",
    layer: (root: string) => noteIndexMemoryLayer(root),
  },
] as const;

for (const adapter of adapters) {
  describe(`note-index (${adapter.name})`, () => {
    const layer = () => adapter.layer(vaultRoot);

    it("lists nothing on an empty vault", async () => {
      await expect(withIndex(layer(), (index) => index.list())).resolves.toEqual(
        [],
      );
    });

    it("saves a new note as <id>.md and reads it back", async () => {
      const note = makeNote("first");

      const saved = await withIndex(layer(), (index) =>
        index.save(note, ""),
      );
      const found = await withIndex(layer(), (index) => index.get("first"));

      expect(saved).toEqual({ note, folder: "" });
      expect(found).toEqual({ note, folder: "" });
      expect(await fileExists(join(vaultRoot, "first.md"))).toBe(true);
    });

    it("round-trips title ownership through save and get", async () => {
      const note = makeNote("locked", { titleLocked: true });

      await withIndex(layer(), (index) => index.save(note, ""));
      const found = await withIndex(layer(), (index) => index.get("locked"));

      expect(found?.note.titleLocked).toBe(true);
      expect(found?.note).toEqual(note);
    });

    it("returns null for a missing id rather than failing", async () => {
      await expect(
        withIndex(layer(), (index) => index.get("nope")),
      ).resolves.toBeNull();
    });

    it("writes a new note into its folder", async () => {
      const note = makeNote("folder-note");

      await withIndex(layer(), (index) => index.save(note, "Work/Projects"));

      expect(
        await fileExists(join(vaultRoot, "Work", "Projects", "folder-note.md")),
      ).toBe(true);
      await expect(
        withIndex(layer(), (index) => index.list({ folder: "Work/Projects" })),
      ).resolves.toEqual([
        {
          id: "folder-note",
          title: note.title,
          created: note.created,
          modified: note.modified,
          pinned: false,
          archived: false,
          folder: "Work/Projects",
        },
      ]);
    });

    it("orders pinned first, then modified desc, then id asc", async () => {
      const notes = [
        makeNote("b-note", { modified: "2026-02-01T00:00:00Z" }),
        makeNote("a-note", { modified: "2026-02-01T00:00:00Z" }),
        makeNote("new", { modified: "2026-03-01T00:00:00Z" }),
        makeNote("pinned", {
          modified: "2026-01-01T00:00:00Z",
          pinned: true,
        }),
      ];

      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          for (const note of notes) yield* index.save(note, "");
        }),
      );
      const listed = await withIndex(layer(), (index) => index.list());

      expect(listed.map((summary) => summary.id)).toEqual([
        "pinned",
        "new",
        "a-note",
        "b-note",
      ]);
    });

    it("excludes archived notes by default and matches folders exactly", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(makeNote("root"), "");
          yield* index.save(makeNote("work"), "Work");
          yield* index.save(makeNote("project"), "Work/Projects");
          yield* index.save(makeNote("archived", { archived: true }), "Work");
        }),
      );

      const work = await withIndex(layer(), (index) =>
        index.list({ folder: "Work" }),
      );
      const all = await withIndex(layer(), (index) => index.list());
      const includingArchived = await withIndex(layer(), (index) =>
        index.list({ includeArchived: true }),
      );

      expect(work.map((summary) => summary.id)).toEqual(["work"]);
      expect(all.map((summary) => summary.id).sort()).toEqual([
        "project",
        "root",
        "work",
      ]);
      expect(includingArchived.map((summary) => summary.id).sort()).toEqual([
        "archived",
        "project",
        "root",
        "work",
      ]);
    });

    it("keeps the basename and moves the file when the folder changes", async () => {
      const note = makeNote("moving");

      await withIndex(layer(), (index) => index.save(note, "Work"));
      await withIndex(layer(), (index) => index.save(note, "Personal"));

      expect(await fileExists(join(vaultRoot, "Work", "moving.md"))).toBe(false);
      expect(await fileExists(join(vaultRoot, "Personal", "moving.md"))).toBe(
        true,
      );
      await expect(
        withIndex(layer(), (index) => index.list({ folder: "Personal" })),
      ).resolves.toMatchObject([{ id: "moving" }]);
    });

    it("lists the Trash in most-recently-modified order and restores by id", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(
            makeNote("newer", { modified: "2026-03-01T00:00:00Z" }),
            "Work",
          );
          yield* index.save(
            makeNote("older", { modified: "2026-02-01T00:00:00Z" }),
            "",
          );
          yield* index.trash("newer");
          yield* index.trash("older");
        }),
      );

      await expect(
        withIndex(layer(), (index) => index.listTrash()),
      ).resolves.toEqual([
        expect.objectContaining({ id: "newer", folder: "Work" }),
        expect.objectContaining({ id: "older", folder: "" }),
      ]);

      const restored = await withIndex(layer(), (index) =>
        index.restore("newer"),
      );
      expect(restored?.folder).toBe("Work");
      expect(await fileExists(join(vaultRoot, "Work", "newer.md"))).toBe(true);
      await expect(
        withIndex(layer(), (index) => index.listTrash()),
      ).resolves.toMatchObject([{ id: "older" }]);
    });

    it("purges one trashed note without touching the others", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(makeNote("keep"), "");
          yield* index.save(makeNote("drop"), "");
          yield* index.trash("keep");
          yield* index.trash("drop");
        }),
      );

      await withIndex(layer(), (index) => index.purge("drop"));

      await expect(
        withIndex(layer(), (index) => index.listTrash()),
      ).resolves.toMatchObject([{ id: "keep" }]);
      expect(await fileExists(join(vaultRoot, ".trash", "drop.md"))).toBe(false);
      expect(await fileExists(join(vaultRoot, ".trash", "keep.md"))).toBe(true);
      await expect(
        withIndex(layer(), (index) => index.get("drop")),
      ).resolves.toBeNull();
    });

    it("returns an empty Trash list when nothing has been deleted", async () => {
      await expect(
        withIndex(layer(), (index) => index.listTrash()),
      ).resolves.toEqual([]);
      await expect(
        withIndex(layer(), (index) => index.restore("missing")),
      ).resolves.toBeNull();
    });

    it("finds notes by title and body, prefix-matching the final word", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(
            makeNote("groceries", { title: "Groceries" }),
            "",
          );
          yield* index.save(
            makeNote("body", {
              title: "Errands",
              body: "Buy milk and the good bread",
            }),
            "",
          );
        }),
      );

      const byTitle = await withIndex(layer(), (index) =>
        index.search("groc"),
      );
      const byBody = await withIndex(layer(), (index) =>
        index.search("brea"),
      );

      expect(byTitle.map((summary) => summary.id)).toEqual(["groceries"]);
      expect(byBody.map((summary) => summary.id)).toEqual(["body"]);
    });

    it("matches titles and bodies, never paths or filenames", async () => {
      await withIndex(layer(), (index) =>
        index.save(
          makeNote("filename-needle", {
            title: "Errands",
            body: "Nothing to see here",
          }),
          "Folder Needle",
        ),
      );

      await expect(
        withIndex(layer(), (index) => index.search("needle")),
      ).resolves.toEqual([]);
      await expect(
        withIndex(layer(), (index) => index.search("Errands")),
      ).resolves.toMatchObject([{ id: "filename-needle" }]);
    });

    it("finds a near-miss spelling in a title or body", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(
            makeNote("groceries", {
              title: "Groceries",
              body: "Milk, eggs, the good bread",
            }),
            "",
          );
          yield* index.save(
            makeNote("cafe", {
              title: "Café",
              body: "Meet me at the coffee shop",
            }),
            "",
          );
        }),
      );

      await expect(
        withIndex(layer(), (index) => index.search("Groceris")),
      ).resolves.toMatchObject([{ id: "groceries" }]);
      await expect(
        withIndex(layer(), (index) => index.search("breaad")),
      ).resolves.toMatchObject([{ id: "groceries" }]);
      await expect(
        withIndex(layer(), (index) => index.search("cofee")),
      ).resolves.toMatchObject([{ id: "cafe" }]);
    });

    it("removes diacritics and never throws on FTS syntax", async () => {
      await withIndex(layer(), (index) =>
        index.save(makeNote("cafe", { title: "Café" }), ""),
      );

      await expect(
        withIndex(layer(), (index) => index.search("cafe")),
      ).resolves.toMatchObject([{ id: "cafe" }]);
      await expect(
        withIndex(layer(), (index) => index.search('AND ( "')),
      ).resolves.toEqual([]);
    });

    it("ranks a title match above repeated body matches", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(
            makeNote("body-heavy", {
              title: "Body",
              body: "widget ".repeat(3),
            }),
            "",
          );
          yield* index.save(
            makeNote("title-heavy", { title: "Widget", body: "nothing here" }),
            "",
          );
        }),
      );

      const results = await withIndex(layer(), (index) =>
        index.search("widget"),
      );

      expect(results[0]?.id).toBe("title-heavy");
    });

    it("honours the search limit", async () => {
      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          for (let number = 0; number < 5; number += 1) {
            yield* index.save(
              makeNote(`alpha-${number}`, { body: "alpha" }),
              "",
            );
          }
        }),
      );

      const results = await withIndex(layer(), (index) =>
        index.search("alpha", 2),
      );

      expect(results).toHaveLength(2);
    });

    it("rebuilds from the vault, skipping internal and attachment folders", async () => {
      await writeNoteFile("Work/real.md", makeNote("real"));
      await writeNoteFile(".notty/hidden.md", makeNote("hidden"));
      await writeNoteFile("attachments/image.md", makeNote("attachment"));
      await writeNoteFile(".secret/deep.md", makeNote("deep"));

      const listed = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.rebuild();
          return yield* index.list();
        }),
      );

      expect(listed).toMatchObject([{ id: "real", folder: "Work" }]);
    });

    it("rebuilds a renamed file and saves back to the renamed path", async () => {
      await withIndex(layer(), (index) =>
        index.save(makeNote("renamed", { title: "Old" }), ""),
      );
      await rename(
        join(vaultRoot, "renamed.md"),
        join(vaultRoot, "Groceries.md"),
      );

      await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.rebuild();
          yield* index.save(makeNote("renamed", { title: "New" }), "");
        }),
      );

      expect(await fileExists(join(vaultRoot, "Groceries.md"))).toBe(true);
      expect(await fileExists(join(vaultRoot, "renamed.md"))).toBe(false);
      await expect(
        withIndex(layer(), (index) => index.get("renamed")),
      ).resolves.toMatchObject({ note: { title: "New" } });
    });

    it("builds a missing index from the vault at startup", async () => {
      await writeNoteFile("startup.md", makeNote("startup"));

      await expect(
        withIndex(layer(), (index) => index.list()),
      ).resolves.toMatchObject([{ id: "startup" }]);
    });

    it("indexes one externally created file without scanning the vault", async () => {
      const note = makeNote("agent-note", { body: "Written by an agent" });

      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          // Written after the index opened, so only `syncFile` can see it.
          yield* Effect.promise(() =>
            writeNoteFile("Work/agent-note.md", note),
          );
          const result = yield* index.syncFile("Work/agent-note.md");
          const listed = yield* index.list();
          return { result, listed };
        }),
      );

      expect(outcome.result).toMatchObject({
        status: "upserted",
        path: "Work/agent-note.md",
        note: { folder: "Work", note: { id: "agent-note" } },
      });
      expect(outcome.listed).toMatchObject([
        { id: "agent-note", folder: "Work", title: note.title },
      ]);
    });

    it("updates one externally modified file in place", async () => {
      await writeNoteFile("edited.md", makeNote("edited", { body: "old" }));

      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.syncFile("edited.md");
          yield* Effect.promise(() =>
            writeNoteFile(
              "edited.md",
              makeNote("edited", { body: "new body", title: "New title" }),
            ),
          );
          const result = yield* index.syncFile("edited.md");
          const found = yield* index.get("edited");
          return { result, found };
        }),
      );

      expect(outcome.result.status).toBe("upserted");
      expect(outcome.found?.note.body).toBe("new body");
      expect(outcome.found?.note.title).toBe("New title");
    });

    it("removes the row when the file disappears", async () => {
      await writeNoteFile("gone.md", makeNote("gone"));

      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.syncFile("gone.md");
          yield* Effect.promise(() => unlink(join(vaultRoot, "gone.md")));
          const result = yield* index.syncFile("gone.md");
          const listed = yield* index.list();
          return { result, listed };
        }),
      );

      expect(outcome.result).toMatchObject({ status: "removed", id: "gone" });
      expect(outcome.listed).toEqual([]);
    });

    it("reports a removal when another process already deleted the row", async () => {
      await writeNoteFile("cli-gone.md", makeNote("cli-gone"));

      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.syncFile("cli-gone.md");
          // Model the CLI: it moves the file to Trash and drops the row from
          // the shared index before the desktop watcher sees the removal.
          yield* index.trash("cli-gone");
          return yield* index.syncFile("cli-gone.md");
        }),
      );

      expect(outcome).toEqual({
        status: "removed",
        id: null,
        path: "cli-gone.md",
      });
    });

    it("ignores the echo of Notty's own save via the stat fingerprint", async () => {
      const note = makeNote("echo", { title: "Echo title", body: "Echo body" });

      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* index.save(note, "Journal");
          const result = yield* index.syncFile("Journal/echo.md");
          return result;
        }),
      );

      // No SQL ran, but the matching note still comes back so callers can
      // reconcile an in-memory list that never saw the row.
      expect(outcome).toMatchObject({
        status: "unchanged",
        path: "Journal/echo.md",
        note: { folder: "Journal", note: { id: "echo", body: "Echo body" } },
      });
    });

    it("reports the indexed note when the CLI already wrote the fingerprint", async () => {
      const note = makeNote("cli-note", {
        title: "Written by the CLI",
        modified: "2026-11-05T12:00:00Z",
      });

      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          // Model the CLI: write the file and commit its fingerprint to the
          // same index before the desktop watcher reports the change.
          yield* Effect.promise(() => writeNoteFile("cli-note.md", note));
          yield* index.syncFile("cli-note.md");
          return yield* index.syncFile("cli-note.md");
        }),
      );

      expect(outcome).toMatchObject({
        status: "unchanged",
        path: "cli-note.md",
        note: {
          folder: "",
          note: {
            id: "cli-note",
            title: "Written by the CLI",
            modified: "2026-11-05T12:00:00Z",
          },
        },
      });
    });

    it("accepts raw Markdown without frontmatter and gives it a stable id", async () => {
      const outcome = await withIndex(layer(), (index) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            writeFile(join(vaultRoot, "from-agent.md"), "# Agent note\n\nBody"),
          );
          const first = yield* index.syncFile("from-agent.md");
          const afterSync = yield* index.list();
          yield* index.rebuild();
          const afterRebuild = yield* index.list();
          return { first, afterSync, afterRebuild };
        }),
      );

      if (outcome.first.status !== "upserted") {
        throw new Error(`Expected an upsert, got ${outcome.first.status}`);
      }
      const id = outcome.first.note.note.id;
      expect(id).toMatch(/^md-[0-9a-f]{16}$/);
      expect(outcome.first.note.note.title).toBe("Agent note");
      expect(outcome.afterSync.map((note) => note.id)).toEqual([id]);
      expect(outcome.afterRebuild.map((note) => note.id)).toEqual([id]);
    });

    it("detects a stale note file by its fingerprint at startup", async () => {
      await withIndex(layer(), (index) =>
        index.save(makeNote("stale", { body: "old body" }), ""),
      );
      await writeNoteFile(
        "stale.md",
        makeNote("stale", { body: "much newer body", title: "New title" }),
      );

      await expect(
        withIndex(layer(), (index) => index.get("stale")),
      ).resolves.toMatchObject({
        note: { body: "much newer body", title: "New title" },
      });
    });

    it("rebuilds when a note file disappears at startup", async () => {
      await withIndex(layer(), (index) =>
        index.save(makeNote("gone"), ""),
      );
      await unlink(join(vaultRoot, "gone.md"));

      await expect(
        withIndex(layer(), (index) => index.get("gone")),
      ).resolves.toBeNull();
    });
  });
}

describe("note-index search performance", () => {
  it("searches thousands of indexed notes without reading their files", async () => {
    const total = 2000;

    const outcome = await withIndex(
      noteIndexMemoryLayer(vaultRoot),
      (index) =>
        Effect.gen(function* () {
          for (let number = 0; number < total; number += 1) {
            yield* index.save(
              makeNote(`note-${number}`, {
                title: `Note ${number}`,
                body:
                  number === 42
                    ? "needleword searchable text"
                    : `searchable text number ${number}`,
              }),
              "",
            );
          }

          // Search must keep working from the index alone.
          yield* Effect.promise(() =>
            unlink(join(vaultRoot, "note-42.md")),
          );

          const started = performance.now();
          const fuzzy = yield* index.search("serchable");
          const elapsed = performance.now() - started;
          const needle = yield* index.search("needlword");

          return { fuzzy, needle, elapsed };
        }),
    );

    expect(outcome.fuzzy).toHaveLength(50);
    expect(outcome.needle.map((note) => note.id)).toContain("note-42");
    expect(outcome.elapsed).toBeLessThan(1500);
  }, 30_000);
});

describe("note-index file-backed startup recovery", () => {
  const layer = () => noteIndexNodeLayer({ root: vaultRoot });

  it("rebuilds a corrupt index file", async () => {
    await writeNoteFile("corrupt.md", makeNote("corrupt"));
    await writeFile(join(vaultRoot, "notty.db"), "not a database");

    await expect(
      withIndex(layer(), (index) => index.list()),
    ).resolves.toMatchObject([{ id: "corrupt" }]);
  });

  it("rebuilds a schema-mismatched index", async () => {
    await writeNoteFile("schema.md", makeNote("schema"));
    const db = new DatabaseSync(join(vaultRoot, "notty.db"));
    db.exec("PRAGMA user_version = 999");
    db.close();

    await expect(
      withIndex(layer(), (index) => index.list()),
    ).resolves.toMatchObject([{ id: "schema" }]);
  });

  it("trusts a fingerprint-matching index without rebuilding it", async () => {
    await withIndex(layer(), (index) =>
      index.save(makeNote("tamper", { body: "original" }), ""),
    );

    const db = new DatabaseSync(join(vaultRoot, "notty.db"));
    db.prepare("UPDATE notes SET body = ? WHERE id = ?").run(
      "changed in the index",
      "tamper",
    );
    db.close();

    await expect(
      withIndex(layer(), (index) => index.get("tamper")),
    ).resolves.toMatchObject({ note: { body: "changed in the index" } });
  });

  it("opens and writes concurrently on an empty vault", async () => {
    const count = 8;
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        withIndex(layer(), (noteIndex) =>
          noteIndex.save(makeNote(`concurrent-${index}`), ""),
        ),
      ),
    );

    const notes = await withIndex(layer(), (noteIndex) => noteIndex.list());
    expect(notes).toHaveLength(count);
  });

  it("writes the file before the index and leaves no row on index failure", async () => {
    const note = makeNote("ordered");
    const databasePath = join(vaultRoot, "notty.db");

    const outcome = await withIndex(layer(), (index) =>
      Effect.gen(function* () {
        // Sabotage the index after acquisition, so the next transaction
        // fails only after the note file has been written.
        const db = new DatabaseSync(databasePath);
        db.exec("DROP TABLE notes_fts");
        db.close();

        const exit = yield* Effect.exit(index.save(note, ""));
        const found = yield* index.get(note.id);
        return { exit, found };
      }),
    );

    expect(Exit.isFailure(outcome.exit)).toBe(true);
    expect(outcome.found).toBeNull();
    expect(await fileExists(join(vaultRoot, "ordered.md"))).toBe(true);
  });
});
