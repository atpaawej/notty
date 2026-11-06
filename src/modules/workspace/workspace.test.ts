import { access, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NoteIndex,
  noteIndexMemoryLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "../note-index";
import {
  createWorkspace,
  type NoteStore,
  type WorkspaceOptions,
} from "./index";

/**
 * Real index behaviour behind the workspace seam. Each call opens a fresh
 * in-memory index, which rebuilds from the note files on disk — the same path
 * a relaunch takes.
 */
const listFolderTree = async (root: string): Promise<ReadonlyArray<string>> => {
  const folders: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(root, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (relative === "" && entry.name === "attachments") continue;
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      folders.push(child);
      await walk(child);
    }
  };
  await walk("");
  return folders.sort((left, right) => left.localeCompare(right));
};

const makeStore = (root: string): NoteStore => {
  const run = <A>(
    action: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* action(index);
      }).pipe(Effect.provide(noteIndexMemoryLayer(root))),
    );

  return {
    list: () => run((index) => index.list()),
    get: (id) => run((index) => index.get(id)),
    save: (note, folder) => run((index) => index.save(note, folder)),
    listFolders: () => listFolderTree(root),
    createFolder: async (folder) => {
      await mkdir(join(root, folder), { recursive: true });
    },
    renameFolder: async (folder, nextFolder) => {
      const target = join(root, nextFolder);
      await mkdir(dirname(target), { recursive: true });
      await rename(join(root, folder), target);
      await run((index) => index.rebuild());
    },
    deleteFolder: async (folder) => {
      await rm(join(root, folder), { recursive: true, force: true });
      await run((index) => index.rebuild());
    },
  };
};

let vaultRoot: string;
let tick: number;
let counter: number;

const clock = (): Date => new Date(tick);
const nextId = (): string => `note-${(counter += 1)}`;
const advance = (milliseconds: number): void => {
  tick += milliseconds;
};

const options = (overrides: Partial<WorkspaceOptions> = {}): WorkspaceOptions => ({
  now: clock,
  newId: nextId,
  debounceMs: 400,
  ...overrides,
});

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "notty-workspace-"));
  tick = Date.parse("2026-11-05T09:14:00Z");
  counter = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(vaultRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  });
});

describe("capture", () => {
  it("shows a new note in the list and selects it before any save lands", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();

    const state = workspace.getState();
    expect(state.notes.map((note) => note.id)).toEqual(["note-1"]);
    expect(state.selectedId).toBe("note-1");
    expect(state.selected).toEqual({
      id: "note-1",
      title: "2026-11-05",
      body: "",
      titleLocked: false,
    });

    await workspace.flush();
  });

  it("creates a fresh empty note every time", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("First note");
    await workspace.createNote();

    expect(workspace.getState().notes).toHaveLength(2);
    expect(workspace.getState().selected?.body).toBe("");

    await workspace.flush();
  });
});

describe("auto-title", () => {
  it("derives the title from the creation date and first body words", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;
    await workspace.createNote();

    workspace.setBody("# Groceries\n\nMilk, eggs, the good bread.");

    expect(workspace.getState().selected?.title).toBe(
      "2026-11-05 — Groceries Milk, eggs, the good bread.",
    );
    await workspace.flush();
  });

  it("stops auto-titling once the user edits the title", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;
    await workspace.createNote();
    workspace.setBody("Some words");
    workspace.setTitle("Groceries");
    workspace.setBody("Completely different body");

    expect(workspace.getState().selected?.title).toBe("Groceries");
    expect(workspace.getState().selected?.titleLocked).toBe(true);
    await workspace.flush();
  });

  it("keeps a user-owned title across a relaunch", async () => {
    const first = createWorkspace(makeStore(vaultRoot), options());
    await first.ready;
    await first.createNote();
    first.setBody("Some words");
    first.setTitle("Groceries");
    first.setBody("Different body");
    await first.flush();
    first.dispose();

    const second = createWorkspace(makeStore(vaultRoot), options());
    await second.ready;

    expect(second.getState().selected?.title).toBe("Groceries");
    expect(second.getState().selected?.titleLocked).toBe(true);
    second.setBody("Yet another body");
    expect(second.getState().selected?.title).toBe("Groceries");
    await second.flush();
  });

  it("bounds its work to the opening words of a long note", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;
    await workspace.createNote();

    workspace.setBody(`one two three four five six ${"tail ".repeat(50_000)}`);

    expect(workspace.getState().selected?.title).toBe(
      "2026-11-05 — one two three four five six",
    );
    await workspace.flush();
  });
});

describe("auto-save", () => {
  it("writes an edit after the debounce and not before", async () => {
    vi.useFakeTimers();
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;
    await workspace.createNote();
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    workspace.setBody("Milk and eggs");
    await vi.advanceTimersByTimeAsync(399);
    expect((await store.get(id))?.note.body).toBe("");

    await vi.advanceTimersByTimeAsync(1);
    await workspace.flush();
    expect((await store.get(id))?.note.body).toBe("Milk and eggs");
  });

  it("keeps typing after a pause saved the previous draft", async () => {
    vi.useFakeTimers();
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;
    await workspace.createNote();
    const id = workspace.getState().selectedId as string;

    workspace.setBody("First");
    await vi.advanceTimersByTimeAsync(400);
    workspace.setBody("First and second");
    await vi.advanceTimersByTimeAsync(400);
    await workspace.flush();

    expect((await store.get(id))?.note.body).toBe("First and second");
  });

  it("restores the note on relaunch", async () => {
    const first = createWorkspace(makeStore(vaultRoot), options());
    await first.ready;
    await first.createNote();
    first.setBody("Milk, eggs, the good bread.");
    await first.flush();
    first.dispose();

    const second = createWorkspace(makeStore(vaultRoot), options());
    await second.ready;

    expect(second.getState().selected?.body).toBe("Milk, eggs, the good bread.");
    expect(second.getState().notes).toHaveLength(1);
  });
});

describe("recency", () => {
  it("orders notes by last touched, newest first", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("First note");
    await workspace.flush();

    advance(60_000);
    await workspace.createNote();
    workspace.setBody("Second note");
    await workspace.flush();
    expect(workspace.getState().notes[0]?.id).toBe("note-2");

    advance(60_000);
    await workspace.selectNote("note-1");
    workspace.setBody("First note, edited");
    await workspace.flush();
    expect(workspace.getState().notes[0]?.id).toBe("note-1");

    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;
    expect(reopened.getState().notes.map((note) => note.id)).toEqual([
      "note-1",
      "note-2",
    ]);
  });
});

describe("selection", () => {
  it("loads the full body when switching notes", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("First body");
    await workspace.flush();

    advance(60_000);
    await workspace.createNote();
    workspace.setBody("Second body");
    await workspace.flush();

    await workspace.selectNote("note-1");

    expect(workspace.getState().selected?.body).toBe("First body");
  });

  it("flushes the previous note before switching away", async () => {
    vi.useFakeTimers();
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Unsaved when switching");
    advance(60_000);
    await workspace.createNote();
    await workspace.selectNote("note-1");

    expect((await store.get("note-1"))?.note.body).toBe("Unsaved when switching");
  });
});

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

describe("folders", () => {
  it("creates and nests folders from the sidebar and restores them", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;

    await workspace.createFolder("Work");
    expect(workspace.getState().folders).toEqual(["Work"]);
    expect(workspace.getState().selectedFolder).toBe("Work");

    await workspace.createFolder("Projects");
    expect(workspace.getState().folders).toEqual(["Work", "Work/Projects"]);
    expect(workspace.getState().selectedFolder).toBe("Work/Projects");
    expect(await fileExists(join(vaultRoot, "Work", "Projects"))).toBe(true);

    await workspace.createNote();
    workspace.setBody("Nested note");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;
    expect((await makeStore(vaultRoot).get(id))?.folder).toBe("Work/Projects");

    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;

    expect(reopened.getState().folders).toEqual(["Work", "Work/Projects"]);
    expect(reopened.getState().notes.find((note) => note.id === id)?.folder).toBe(
      "Work/Projects",
    );
  });

  it("moves a note between folders and back again", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Misfiled note");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    await workspace.createFolder("Work");
    await workspace.moveNote(id, "Work");

    expect(workspace.getState().notes.find((note) => note.id === id)?.folder).toBe(
      "Work",
    );
    expect((await store.get(id))?.folder).toBe("Work");
    expect(await fileExists(join(vaultRoot, "Work", `${id}.md`))).toBe(true);

    await workspace.moveNote(id, "");
    expect((await store.get(id))?.folder).toBe("");
    expect(await fileExists(join(vaultRoot, `${id}.md`))).toBe(true);

    await workspace.moveNote(id, "Work");
    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;
    expect(reopened.getState().notes.find((note) => note.id === id)?.folder).toBe(
      "Work",
    );
  });

  it("renames a folder with its notes still inside", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createFolder("Work");
    await workspace.createNote();
    workspace.setBody("Keep me");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    await workspace.renameFolder("Work", "Office");

    expect(workspace.getState().folders).toEqual(["Office"]);
    expect(workspace.getState().selectedFolder).toBe("Office");
    expect(workspace.getState().notes.find((note) => note.id === id)?.folder).toBe(
      "Office",
    );
    expect(await fileExists(join(vaultRoot, "Office", `${id}.md`))).toBe(true);
    expect((await store.get(id))?.folder).toBe("Office");

    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;
    expect(reopened.getState().folders).toEqual(["Office"]);
    expect(reopened.getState().notes.find((note) => note.id === id)?.folder).toBe(
      "Office",
    );
  });

  it("deletes a folder, its notes and the index rows that pointed at it", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Keep this one");
    await workspace.flush();
    const kept = workspace.getState().selectedId as string;

    await workspace.createFolder("Work");
    await workspace.createNote();
    workspace.setBody("Delete this one");
    await workspace.flush();
    const removed = workspace.getState().selectedId as string;

    await workspace.deleteFolder("Work");

    expect(workspace.getState().folders).toEqual([]);
    expect(workspace.getState().notes.map((note) => note.id)).toEqual([kept]);
    expect(await store.get(removed)).toBeNull();
    expect(await fileExists(join(vaultRoot, "Work"))).toBe(false);
    expect(await fileExists(join(vaultRoot, `${kept}.md`))).toBe(true);

    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;
    expect(reopened.getState().notes.map((note) => note.id)).toEqual([kept]);
  });
});

