import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serialize, type Note } from "../note-file";
import {
  NoteIndex,
  noteIndexMemoryLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "../note-index";
import { createMemoryVaultWatcher } from "../vault";
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

type Run = <A>(
  action: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
) => Promise<A>;

const runAction = <A>(
  action: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
): Effect.Effect<A, NoteIndexError, NoteIndex> =>
  Effect.gen(function* () {
    const index = yield* NoteIndex;
    return yield* action(index);
  });

/** Build the workspace's `NoteStore` over whichever index `run` owns. */
const makeStoreWith = (root: string, run: Run): NoteStore => ({
  list: (listOptions) => run((index) => index.list(listOptions)),
  get: (id) => run((index) => index.get(id)),
  save: (note, folder) => run((index) => index.save(note, folder)),
  syncFile: (relativePath) => run((index) => index.syncFile(relativePath)),
  search: (query, limit) => run((index) => index.search(query, limit)),
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
  listTrash: () => run((index) => index.listTrash()),
  trashNote: async (id) => {
    await run((index) => index.trash(id));
  },
  restoreNote: (id) => run((index) => index.restore(id)),
  purgeNote: async (id) => {
    await run((index) => index.purge(id));
  },
});

/** A store whose index opens, rebuilds and closes for each call. */
const makeStore = (root: string): NoteStore =>
  makeStoreWith(root, (action) =>
    Effect.runPromise(
      runAction(action).pipe(Effect.provide(noteIndexMemoryLayer(root))),
    ),
  );

/**
 * A store with one long-lived index for the whole test. External file
 * changes only reach `syncFile` when the same index survives across calls,
 * which is what the running app does.
 */
const makeLiveStore = (root: string): NoteStore => {
  const runtime = ManagedRuntime.make(noteIndexMemoryLayer(root));
  liveRuntimes.push(runtime);
  return makeStoreWith(root, (action) => runtime.runPromise(runAction(action)));
};

/** A live index plus an in-memory watcher bound to the temporary vault. */
const makeWatchedStore = (
  root: string,
  watcher: ReturnType<typeof createMemoryVaultWatcher>,
): NoteStore => ({
  ...makeLiveStore(root),
  watchVault: (onChange) => watcher.watch(root, onChange),
});

let vaultRoot: string;
let tick: number;
let counter: number;
const liveRuntimes: Array<{ dispose: () => Promise<void> }> = [];

const clock = (): Date => new Date(tick);
const nextId = (): string => `note-${(counter += 1)}`;
const advance = (milliseconds: number): void => {
  tick += milliseconds;
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for a condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** Yield the event loop so queued watcher work can start. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 10));

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
  await Promise.all(liveRuntimes.map((runtime) => runtime.dispose()));
  liveRuntimes.length = 0;
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
      title: "New Note",
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
  it("derives the title from the first body line without a date prefix", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;
    await workspace.createNote();

    workspace.setBody("# Groceries\n\nMilk, eggs, the good bread.");

    expect(workspace.getState().selected?.title).toBe("Groceries");
    await workspace.flush();
  });

  it("strips checklist and list syntax from the auto-title", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;
    await workspace.createNote();

    workspace.setBody("- [ ] Buy groceries and milk");

    expect(workspace.getState().selected?.title).toBe(
      "Buy groceries and milk",
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
      "one two three four five six",
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

  it("queues the previous note's save when switching away", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Unsaved when switching");
    advance(60_000);
    await workspace.createNote();
    await workspace.selectNote("note-1");
    await workspace.flush();

    expect((await store.get("note-1"))?.note.body).toBe("Unsaved when switching");
  });

  it("opens the next note without waiting for the previous note's save", async () => {
    const first: Note = {
      id: "first",
      title: "First",
      created: "2026-11-05T09:00:00.000Z",
      modified: "2026-11-05T09:00:00.000Z",
      pinned: false,
      archived: false,
      body: "First body",
    };
    const second: Note = {
      ...first,
      id: "second",
      title: "Second",
      body: "Second body",
    };
    await writeFile(join(vaultRoot, "first.md"), serialize(first));
    await writeFile(join(vaultRoot, "second.md"), serialize(second));

    let releaseSave: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const base = makeStore(vaultRoot);
    const store: NoteStore = {
      ...base,
      save: async (note, folder) => {
        await saveGate;
        return base.save(note, folder);
      },
    };
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.selectNote("second");
    workspace.setBody("Second body, edited");
    await workspace.selectNote("first");

    expect(workspace.getState().selected?.body).toBe("First body");

    releaseSave();
    await workspace.flush();
  });
});

describe("pin, archive and duplicate", () => {
  it("pins a note to the top and survives a relaunch", async () => {
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
    expect(workspace.getState().notes.map((note) => note.id)).toEqual([
      "note-2",
      "note-1",
    ]);

    await workspace.togglePin("note-1");

    expect(workspace.getState().notes.map((note) => note.id)).toEqual([
      "note-1",
      "note-2",
    ]);
    expect(workspace.getState().notes[0]?.pinned).toBe(true);
    expect((await store.get("note-1"))?.note.pinned).toBe(true);

    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;
    expect(reopened.getState().notes.map((note) => note.id)).toEqual([
      "note-1",
      "note-2",
    ]);

    await reopened.togglePin("note-1");
    expect(reopened.getState().notes.map((note) => note.id)).toEqual([
      "note-2",
      "note-1",
    ]);
    await reopened.flush();
  });

  it("archives a note without deleting it and unarchives it later", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Keep me safe");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    await workspace.setArchived(id, true);

    expect(workspace.getState().selectedId).toBeNull();
    expect(workspace.getState().selected).toBeNull();
    expect(workspace.getState().notes).toEqual([]);
    expect((await store.get(id))?.note.body).toBe("Keep me safe");
    expect((await store.get(id))?.note.archived).toBe(true);

    const reopened = createWorkspace(makeStore(vaultRoot), options());
    await reopened.ready;
    expect(reopened.getState().selectedId).toBeNull();
    expect(reopened.getState().notes).toEqual([]);

    reopened.selectArchive();
    expect(reopened.getState().showArchived).toBe(true);
    expect(reopened.getState().selectedView).toBe("archive");
    expect(reopened.getState().notes.map((note) => note.id)).toEqual([id]);
    await reopened.selectNote(id);
    expect(reopened.getState().selected?.body).toBe("Keep me safe");

    await reopened.setArchived(id, false);
    expect(reopened.getState().notes).toEqual([]);
    reopened.selectFolder(null);
    expect(reopened.getState().notes.map((note) => note.id)).toEqual([id]);
    expect((await store.get(id))?.note.archived).toBe(false);
    await reopened.flush();
  });

  it("duplicates a note with the same body, a new identity and new timestamps", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Template body");
    workspace.setTitle("Template");
    await workspace.flush();
    const originalId = workspace.getState().selectedId as string;

    advance(60_000);
    await workspace.duplicateNote(originalId);
    await workspace.flush();

    const state = workspace.getState();
    expect(state.notes).toHaveLength(2);
    expect(state.selectedId).toBe("note-2");
    expect(state.selected?.body).toBe("Template body");
    expect(state.selected?.title).toBe("Template");

    const original = await store.get(originalId);
    const copy = await store.get("note-2");
    expect(original?.note.body).toBe("Template body");
    expect(original?.note.created).toBe("2026-11-05T09:14:00.000Z");
    expect(copy?.note.body).toBe("Template body");
    expect(copy?.note.created).toBe("2026-11-05T09:15:00.000Z");
    expect(copy?.note.modified).toBe("2026-11-05T09:15:00.000Z");
    expect(copy?.note.id).not.toBe(originalId);
    expect(copy?.folder).toBe(original?.folder);
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

describe("trash", () => {
  it("moves a note out of the list, shows it in the Trash, and restores it", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Recover me");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    await workspace.trashNote(id);

    expect(workspace.getState().notes).toEqual([]);
    expect(workspace.getState().selectedId).toBeNull();
    expect(workspace.getState().selected).toBeNull();
    expect(await store.get(id)).toBeNull();

    await workspace.selectTrash();
    expect(workspace.getState().selectedView).toBe("trash");
    expect(workspace.getState().notes.map((note) => note.id)).toEqual([id]);
    expect(workspace.getState().notes[0]?.title).toBe("Recover me");

    await workspace.restoreNote(id);
    expect(workspace.getState().notes).toEqual([]);

    workspace.selectFolder(null);
    expect(workspace.getState().selectedView).toBe("all");
    expect(workspace.getState().notes.map((note) => note.id)).toEqual([id]);
    expect((await store.get(id))?.note.body).toBe("Recover me");
  });

  it("permanently deletes one note and can empty the rest", async () => {
    const store = makeStore(vaultRoot);
    const workspace = createWorkspace(store, options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("One");
    await workspace.flush();
    const first = workspace.getState().selectedId as string;

    await workspace.createNote();
    workspace.setBody("Two");
    await workspace.flush();
    const second = workspace.getState().selectedId as string;

    await workspace.trashNote(first);
    await workspace.trashNote(second);
    await workspace.selectTrash();
    expect(workspace.getState().notes).toHaveLength(2);

    await workspace.purgeNote(first);
    expect(workspace.getState().notes.map((note) => note.id)).toEqual([second]);

    await workspace.emptyTrash();
    expect(workspace.getState().notes).toEqual([]);
    await expect(store.listTrash()).resolves.toEqual([]);
  });

  it("creates a folder and moves the note into it", async () => {
    const workspace = createWorkspace(makeStore(vaultRoot), options());
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Move me");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    const folder = await workspace.createFolder("Archive 2026");
    expect(folder).toBe("Archive 2026");

    await workspace.moveNote(id, folder as string);
    expect((await makeStore(vaultRoot).get(id))?.folder).toBe("Archive 2026");
    expect(await fileExists(join(vaultRoot, "Archive 2026", `${id}.md`))).toBe(
      true,
    );
  });
});

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

describe("search", () => {
  it("debounces typing, then opens a matching note in the editor", async () => {
    const store = makeStore(vaultRoot);
    const search = vi.fn(store.search);
    const workspace = createWorkspace(
      { ...store, search },
      options({ searchDebounceMs: 60 }),
    );
    await workspace.ready;

    await workspace.createNote();
    workspace.setBody("Groceries and milk");
    await workspace.flush();
    const groceries = workspace.getState().selectedId as string;

    advance(60_000);
    await workspace.createNote();
    workspace.setBody("An unrelated second note");
    await workspace.flush();

    workspace.setSearchQuery("groc");
    expect(workspace.getState().searchQuery).toBe("groc");
    expect(workspace.getState().searching).toBe(true);
    expect(workspace.getState().searchResults).toEqual([]);
    expect(search).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(search).not.toHaveBeenCalled();

    await waitFor(() => !workspace.getState().searching);
    expect(search).toHaveBeenCalledWith("groc");
    expect(workspace.getState().searchResults.map((note) => note.id)).toEqual([
      groceries,
    ]);

    await workspace.selectNote(groceries);
    expect(workspace.getState().selected?.body).toBe("Groceries and milk");

    workspace.setSearchQuery("");
    expect(workspace.getState().searchQuery).toBe("");
    expect(workspace.getState().searchResults).toEqual([]);
    expect(workspace.getState().searching).toBe(false);
    await workspace.flush();
  });
});

const externalNote = (id: string, title: string, body: string): Note => ({
  id,
  title,
  created: "2026-11-05T10:00:00.000Z",
  modified: "2026-11-05T10:00:00.000Z",
  pinned: false,
  archived: false,
  body,
});

describe("realtime vault changes", () => {
  it("shows a note created outside Notty", async () => {
    const watcher = createMemoryVaultWatcher();
    const workspace = createWorkspace(
      makeWatchedStore(vaultRoot, watcher),
      options(),
    );
    await workspace.ready;
    await settle();

    await writeFile(
      join(vaultRoot, "groceries.md"),
      serialize(externalNote("groceries", "Groceries", "Milk, eggs")),
    );
    watcher.emit({ kind: "create", path: "groceries.md" });

    await waitFor(() =>
      workspace.getState().notes.some((note) => note.id === "groceries"),
    );
    expect(workspace.getState().notes[0]?.title).toBe("Groceries");
    workspace.dispose();
  });

  it("reloads the open note when an external tool changes it", async () => {
    const watcher = createMemoryVaultWatcher();
    const store = makeWatchedStore(vaultRoot, watcher);
    const workspace = createWorkspace(store, options());
    await workspace.ready;
    await workspace.createNote();
    workspace.setBody("Local body");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    const saved = await store.get(id);
    await writeFile(
      join(vaultRoot, `${id}.md`),
      serialize({ ...(saved as NonNullable<typeof saved>).note, body: "A much longer external body" }),
    );
    watcher.emit({ kind: "update", path: `${id}.md` });

    await waitFor(
      () => workspace.getState().selected?.body === "A much longer external body",
    );
    workspace.dispose();
  });

  it("keeps unsaved keystrokes when the open file changes on disk", async () => {
    const watcher = createMemoryVaultWatcher();
    const store = makeWatchedStore(vaultRoot, watcher);
    const workspace = createWorkspace(store, options());
    await workspace.ready;
    await workspace.createNote();
    workspace.setBody("Saved body");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    workspace.setBody("Unsaved local edit");

    const saved = await store.get(id);
    await writeFile(
      join(vaultRoot, `${id}.md`),
      serialize({ ...(saved as NonNullable<typeof saved>).note, body: "External body" }),
    );
    watcher.emit({ kind: "update", path: `${id}.md` });
    await settle();

    expect(workspace.getState().selected?.body).toBe("Unsaved local edit");

    await workspace.flush();
    expect((await store.get(id))?.note.body).toBe("Unsaved local edit");
    workspace.dispose();
  });

  it("closes the open note when its file disappears", async () => {
    const watcher = createMemoryVaultWatcher();
    const workspace = createWorkspace(
      makeWatchedStore(vaultRoot, watcher),
      options(),
    );
    await workspace.ready;
    await workspace.createNote();
    workspace.setBody("Delete me");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    await unlink(join(vaultRoot, `${id}.md`));
    watcher.emit({ kind: "remove", path: `${id}.md` });

    await waitFor(() => workspace.getState().selectedId === null);
    expect(workspace.getState().selected).toBeNull();
    expect(workspace.getState().notes).toEqual([]);
    workspace.dispose();
  });

  it("reflects a note moved into a new folder outside Notty", async () => {
    const watcher = createMemoryVaultWatcher();
    const workspace = createWorkspace(
      makeWatchedStore(vaultRoot, watcher),
      options(),
    );
    await workspace.ready;
    await workspace.createNote();
    workspace.setBody("Move me");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    await mkdir(join(vaultRoot, "Work"), { recursive: true });
    await rename(
      join(vaultRoot, `${id}.md`),
      join(vaultRoot, "Work", `${id}.md`),
    );
    watcher.emit({ kind: "create", path: "Work", isDirectory: true });
    watcher.emit({ kind: "remove", path: `${id}.md` });
    watcher.emit({ kind: "create", path: `Work/${id}.md` });

    await waitFor(() =>
      workspace
        .getState()
        .notes.some((note) => note.id === id && note.folder === "Work"),
    );
    expect(workspace.getState().folders).toContain("Work");
    workspace.dispose();
  });

  it("does not render for the watcher echo of its own save", async () => {
    const watcher = createMemoryVaultWatcher();
    const workspace = createWorkspace(
      makeWatchedStore(vaultRoot, watcher),
      options(),
    );
    await workspace.ready;
    await workspace.createNote();
    workspace.setBody("Saved body");
    await workspace.flush();
    const id = workspace.getState().selectedId as string;

    let echoRenders = 0;
    workspace.subscribe(() => {
      const state = workspace.getState();
      if (!state.notes.some((note) => note.id === "sentinel")) echoRenders += 1;
    });

    watcher.emit({ kind: "update", path: `${id}.md` });

    // A second, real change is queued behind the echo. Waiting for it proves
    // the chain finished with the echo before the render count is read.
    await writeFile(
      join(vaultRoot, "sentinel.md"),
      serialize(externalNote("sentinel", "Sentinel", "Done")),
    );
    watcher.emit({ kind: "create", path: "sentinel.md" });

    await waitFor(() =>
      workspace.getState().notes.some((note) => note.id === "sentinel"),
    );
    expect(echoRenders).toBe(0);
    workspace.dispose();
  });
});

