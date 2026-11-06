import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { parseNote, type Note } from "../note-file";
import {
  NoteIndex,
  noteIndexNodeLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "../note-index";
import {
  Vault,
  vaultProductionLayer,
  type VaultPaths,
  type VaultShape,
} from "./index";

let tempXdgDir: string;
const originalXdg = process.env.XDG_DATA_HOME;

beforeEach(async () => {
  tempXdgDir = await mkdtemp(join(tmpdir(), "notty-vault-machine-test-"));
  process.env.XDG_DATA_HOME = tempXdgDir;
});

afterEach(async () => {
  if (originalXdg === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalXdg;
  }
  await rm(tempXdgDir, { recursive: true, force: true });
});

const withVault = <A>(
  run: (vault: VaultShape) => Effect.Effect<A, unknown>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault;
      return yield* run(vault);
    }).pipe(Effect.provide(vaultProductionLayer)),
  );

const withIndex = <A>(
  root: string,
  run: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return yield* run(index);
    }).pipe(Effect.provide(noteIndexNodeLayer({ root }))),
  );

const existsOnDisk = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

describe("Vault machine storage & persistence across app restarts", () => {
  it("creates vault directories on disk, saves notes, and persists across simulated restarts", async () => {
    // 1. Ensure vault on machine disk
    const paths: VaultPaths = await withVault((vault) =>
      Effect.gen(function* () {
        yield* vault.ensure();
        return yield* vault.location();
      }),
    );

    // Verify disk directories were created
    expect(await existsOnDisk(paths.root)).toBe(true);
    expect(await existsOnDisk(paths.attachments)).toBe(true);
    expect(await existsOnDisk(paths.internal)).toBe(true);
    expect(await existsOnDisk(paths.trash)).toBe(true);

    const note1: Note = {
      id: "machine-note-1",
      title: "First Persistent Note",
      created: "2026-11-06T10:00:00.000Z",
      modified: "2026-11-06T10:00:00.000Z",
      pinned: true,
      archived: false,
      body: "# First Persistent Note\n\nThis note is written to machine disk.",
    };

    const note2: Note = {
      id: "machine-note-2",
      title: "Second Persistent Note",
      created: "2026-11-06T10:01:00.000Z",
      modified: "2026-11-06T10:01:00.000Z",
      pinned: false,
      archived: false,
      body: "Another note in a subfolder.",
    };

    // 2. First session: Save notes
    await withIndex(paths.root, (index) =>
      Effect.gen(function* () {
        yield* index.save(note1, "");
        yield* index.save(note2, "work");
      }),
    );

    // Verify physical files exist on the machine
    const note1Path = join(paths.root, `${note1.id}.md`);
    const note2Path = join(paths.root, "work", `${note2.id}.md`);
    const dbPath = join(paths.root, "notty.db");

    expect(await existsOnDisk(note1Path)).toBe(true);
    expect(await existsOnDisk(note2Path)).toBe(true);
    expect(await existsOnDisk(dbPath)).toBe(true);

    // Verify file contents on disk match note serialization
    const rawNote1 = await readFile(note1Path, "utf8");
    const parsedNote1 = parseNote(rawNote1);
    expect(parsedNote1).toEqual(note1);

    const rawNote2 = await readFile(note2Path, "utf8");
    const parsedNote2 = parseNote(rawNote2);
    expect(parsedNote2).toEqual(note2);

    // 3. Second session: Simulate app restart by acquiring a fresh NoteIndex layer
    const loadedNotes = await withIndex(paths.root, (index) => index.list());
    expect(loadedNotes.length).toBe(2);

    // Pinned note comes first
    expect(loadedNotes[0]?.id).toBe("machine-note-1");
    expect(loadedNotes[0]?.title).toBe("First Persistent Note");
    expect(loadedNotes[0]?.pinned).toBe(true);
    expect(loadedNotes[0]?.folder).toBe("");

    expect(loadedNotes[1]?.id).toBe("machine-note-2");
    expect(loadedNotes[1]?.title).toBe("Second Persistent Note");
    expect(loadedNotes[1]?.folder).toBe("work");

    // Fetch individual note by id after restart
    const retrieved = await withIndex(paths.root, (index) =>
      index.get("machine-note-2"),
    );
    expect(retrieved).not.toBeNull();
    expect(retrieved?.note).toEqual(note2);
    expect(retrieved?.folder).toBe("work");
  });
});
