import { access, mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { normalizeMarkdown } from "./modules/editor";
import type { Note } from "./modules/note-file";
import { NoteIndex, noteIndexNodeLayer } from "./modules/note-index";
import {
  resolveVaultPaths,
  Vault,
  vaultProductionLayer,
} from "./modules/vault";
import { seedWelcomeNotes } from "./welcome-notes";

const originalXdg = process.env.XDG_DATA_HOME;
let tempDir: string;
let root: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "notty-welcome-"));
  process.env.XDG_DATA_HOME = tempDir;
  root = resolveVaultPaths(tempDir, tempDir).root;
  // The production index layer ensures the vault first; the Node layer is
  // handed an existing root, so mirror that here.
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  await rm(tempDir, { recursive: true, force: true });
});

/** Each call is a fresh runtime, a stand-in for one app launch. */
const run = <A, E>(
  effect: Effect.Effect<A, E, Vault | NoteIndex>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.merge(vaultProductionLayer, noteIndexNodeLayer({ root })),
      ),
    ),
  );

const list = () =>
  run(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return yield* index.list({ includeArchived: true });
    }),
  );

const byTitle = async (title: string) => {
  const summary = (await list()).find((note) => note.title === title);
  if (summary === undefined) return null;
  return run(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return yield* index.get(summary.id);
    }),
  );
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const userNote = (id: string, title: string): Note => ({
  id,
  title,
  created: "2026-11-01T09:00:00.000Z",
  modified: "2026-11-01T09:00:00.000Z",
  pinned: false,
  archived: false,
  body: "Words that were already here.",
});

describe("welcome notes seeding", () => {
  it("seeds a welcome note and two samples on first launch", async () => {
    await run(seedWelcomeNotes());

    const notes = await list();
    expect(notes.map((note) => note.title)).toEqual([
      "Welcome to Notty",
      "Sample: lists and an image",
      "Sample: a table",
    ]);

    const welcome = await byTitle("Welcome to Notty");
    expect(welcome?.folder).toBe("");
    expect(welcome?.note.body).toContain("`Ctrl+N`");
    expect(welcome?.note.body).toContain("`Ctrl+Shift+Space`");
    expect(welcome?.note.body).toContain("`Esc`");
    expect(welcome?.note.body).toContain("Markdown");
    expect(welcome?.note.body).toContain("Pin");
    expect(welcome?.note.body).toContain("Archive");
    expect(welcome?.note.body).toContain("30 days");

    const lists = await byTitle("Sample: lists and an image");
    expect(lists?.note.body).toContain("- [ ] Draft the announcement");
    expect(lists?.note.body).toContain("- [x] Make coffee");
    expect(lists?.note.body).toContain("1. Raise Notty");

    const table = await byTitle("Sample: a table");
    expect(table?.note.body).toContain("| --- | --- | --- |");

    const reference = /!\[[^\]]*\]\((attachments\/[^)]+\.svg)\)/.exec(
      lists?.note.body ?? "",
    )?.[1];
    expect(reference).toBeDefined();
    expect(await fileExists(join(root, reference as string))).toBe(true);
  });

  it("seeds bodies the editor can round-trip unchanged", async () => {
    await run(seedWelcomeNotes());

    for (const summary of await list()) {
      const found = await byTitle(summary.title);
      const once = normalizeMarkdown(found?.note.body ?? "");
      expect(normalizeMarkdown(once)).toBe(once);
    }
  });

  it("seeds exactly once across launches", async () => {
    await run(seedWelcomeNotes());
    await run(seedWelcomeNotes());
    await run(seedWelcomeNotes());

    expect(await list()).toHaveLength(3);
  });

  it("does not recreate samples that the user deleted", async () => {
    await run(seedWelcomeNotes());
    const samples = (await list()).filter((note) =>
      note.title.startsWith("Sample:"),
    );
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      await unlink(join(root, `${sample.id}.md`));
    }

    await run(seedWelcomeNotes());

    expect((await list()).map((note) => note.title)).toEqual([
      "Welcome to Notty",
    ]);
    expect(await fileExists(join(root, `${samples[0]?.id}.md`))).toBe(false);
  });

  it("leaves a vault that already holds notes alone", async () => {
    await run(
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        yield* index.save(userNote("mine", "Already mine"), "");
      }),
    );

    await run(seedWelcomeNotes());
    await run(seedWelcomeNotes());

    const notes = await list();
    expect(notes.map((note) => note.title)).toEqual(["Already mine"]);
    expect(await byTitle("Welcome to Notty")).toBeNull();
  });

  it("leaves seeded samples as ordinary, movable notes", async () => {
    await run(seedWelcomeNotes());
    const sample = (await list()).find((note) =>
      note.title.startsWith("Sample: lists"),
    );
    expect(sample).toBeDefined();

    const moved = await run(
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        const found = yield* index.get(sample?.id ?? "");
        if (found === null) return null;
        return yield* index.save(
          { ...found.note, body: `${found.note.body}\nEdited by hand.` },
          "Samples",
        );
      }),
    );

    expect(moved?.folder).toBe("Samples");
    expect(moved?.note.body).toContain("Edited by hand.");
    expect(await fileExists(join(root, "Samples", `${sample?.id}.md`))).toBe(
      true,
    );
  });
});
