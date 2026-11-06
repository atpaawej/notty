/**
 * Private: the workspace controller.
 *
 * Owns selection, auto-title, optimistic list updates and auto-save
 * scheduling. It talks to storage through the small `NoteStore` interface so
 * it runs unchanged in React, in tests and over a real index.
 *
 * No React and no DOM here: the controller is the test surface.
 */
import { deriveAutoTitle, type Note } from "../note-file";
import type {
  IndexedNote,
  NoteSummary,
} from "../note-index";

/** The persistence surface the workspace needs. */
export interface NoteStore {
  readonly list: (options?: {
    /** Include notes hidden from the normal list by the Archive flag. */
    readonly includeArchived?: boolean;
  }) => Promise<ReadonlyArray<NoteSummary>>;
  readonly get: (id: string) => Promise<IndexedNote | null>;
  readonly save: (note: Note, folder: string) => Promise<IndexedNote>;
  /** Every folder as a vault-relative POSIX path, sorted. */
  readonly listFolders: () => Promise<ReadonlyArray<string>>;
  readonly createFolder: (folder: string) => Promise<void>;
  readonly renameFolder: (folder: string, nextFolder: string) => Promise<void>;
  readonly deleteFolder: (folder: string) => Promise<void>;
}

/** The part of a note the editor displays. */
export interface EditorNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly titleLocked: boolean;
}

export interface WorkspaceState {
  /** Note list, last touched first (pinned, then modified, then id). */
  readonly notes: ReadonlyArray<NoteSummary>;
  /** Folder tree as vault-relative POSIX paths. */
  readonly folders: ReadonlyArray<string>;
  /** `null` means All Notes; otherwise an exact folder path. */
  readonly selectedFolder: string | null;
  /** True while the note list shows archived notes instead of active ones. */
  readonly showArchived: boolean;
  readonly selectedId: string | null;
  readonly selected: EditorNote | null;
  /** False while the initial list is still being read. */
  readonly ready: boolean;
}

export interface WorkspaceOptions {
  /** Edit-to-save delay. The product budget is 300–500 ms. */
  readonly debounceMs?: number;
  /** How many body words the auto-title keeps. Defaults to 6. */
  readonly autoTitleWords?: number;
  /** Clock seam. Defaults to the system clock. */
  readonly now?: () => Date;
  /** Identity seam. Defaults to `crypto.randomUUID`. */
  readonly newId?: () => string;
}

export interface WorkspaceController {
  readonly getState: () => WorkspaceState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Resolves once the initial note list (and its selection) has loaded. */
  readonly ready: Promise<void>;
  /** Create, show and save an empty note. Resolves before the first save. */
  readonly createNote: () => Promise<void>;
  readonly selectNote: (id: string) => Promise<void>;
  /** Select a folder, or `null` for All Notes. */
  readonly selectFolder: (folder: string | null) => void;
  /** Show archived notes; the normal list hides them. */
  readonly selectArchive: () => void;
  /** Pin or unpin a note with one action. */
  readonly togglePin: (id: string) => Promise<void>;
  /** Hide a note from the normal list, or bring it back. */
  readonly setArchived: (id: string, archived: boolean) => Promise<void>;
  /** Copy a note into the same folder with a new identity and timestamps. */
  readonly duplicateNote: (id: string) => Promise<void>;
  /** Create a folder (nested under the selection) and select it. */
  readonly createFolder: (name: string) => Promise<void>;
  /** Rename a folder in place, keeping its notes. */
  readonly renameFolder: (folder: string, name: string) => Promise<void>;
  /** Delete a folder and the notes beneath it. */
  readonly deleteFolder: (folder: string) => Promise<void>;
  /** Move a note into a folder; `""` is the vault root. */
  readonly moveNote: (id: string, folder: string) => Promise<void>;
  /** Update the body; auto-title follows unless the title is user-owned. */
  readonly setBody: (markdown: string) => void;
  /** Take ownership of the title; auto-titling stops permanently. */
  readonly setTitle: (title: string) => void;
  /** Write any pending edit now. Safe to call repeatedly. */
  readonly flush: () => Promise<void>;
  /** Flush and stop the debounce timer. The controller stays usable. */
  readonly dispose: () => void;
}

interface PendingSave {
  readonly note: Note;
  readonly folder: string;
}

const DEFAULT_DEBOUNCE_MS = 400;

const defaultNewId = (): string => {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const editorNote = (note: Note): EditorNote => ({
  id: note.id,
  title: note.title,
  body: note.body,
  titleLocked: note.titleLocked === true,
});

const summaryOf = (note: Note, folder: string): NoteSummary => ({
  id: note.id,
  title: note.title,
  created: note.created,
  modified: note.modified,
  pinned: note.pinned,
  archived: note.archived,
  folder,
});

/** Mirrors the index's own ordering so optimistic updates never jump around. */
const compareSummaries = (left: NoteSummary, right: NoteSummary): number => {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  if (left.modified !== right.modified) return left.modified < right.modified ? 1 : -1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

const sorted = (
  notes: ReadonlyArray<NoteSummary>,
): ReadonlyArray<NoteSummary> => [...notes].sort(compareSummaries);

const withSummary = (
  notes: ReadonlyArray<NoteSummary>,
  summary: NoteSummary,
): ReadonlyArray<NoteSummary> =>
  sorted([...notes.filter((note) => note.id !== summary.id), summary]);

const sortedFolders = (
  folders: ReadonlyArray<string>,
): ReadonlyArray<string> => [...folders].sort((left, right) => left.localeCompare(right));

/** The notes the current view shows: one folder or all, active or archived. */
const viewOf = (
  notes: ReadonlyArray<NoteSummary>,
  selectedFolder: string | null,
  showArchived: boolean,
): ReadonlyArray<NoteSummary> =>
  notes.filter((note) =>
    showArchived
      ? note.archived
      : !note.archived &&
        (selectedFolder === null || note.folder === selectedFolder),
  );

const parentOf = (folder: string): string => {
  const slash = folder.lastIndexOf("/");
  return slash < 0 ? "" : folder.slice(0, slash);
};

const isInside = (folder: string, parent: string): boolean =>
  folder === parent || folder.startsWith(`${parent}/`);

/**
 * Sidebar-entered names are relative paths. Hidden segments are rejected so
 * the filesystem tree and the sidebar tree cannot disagree.
 */
const folderSegments = (name: string): ReadonlyArray<string> | null => {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/") || trimmed.includes("\\")) {
    return null;
  }
  const segments = trimmed
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === ".." || segment.startsWith("."))
  ) {
    return null;
  }
  return segments;
};

const remapFolder = (folder: string, from: string, to: string): string => {
  if (folder === from) return to;
  return folder.startsWith(`${from}/`) ? `${to}${folder.slice(from.length)}` : folder;
};

/**
 * The auto-title reads the body's opening words, not its Markdown syntax.
 * Only a bounded prefix is scanned so a very long note costs the same as a
 * short one on every keystroke.
 */
const cleanTitleText = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[`*_~#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const leadingWords = (markdown: string, maxWords: number): string => {
  const words: string[] = [];
  let index = 0;

  while (index < markdown.length && words.length < maxWords) {
    while (index < markdown.length && /\s/.test(markdown[index])) index += 1;
    if (index >= markdown.length) break;
    const start = index;
    while (index < markdown.length && !/\s/.test(markdown[index])) index += 1;
    words.push(markdown.slice(start, index));
  }

  return cleanTitleText(words.join(" "));
};

export function createWorkspace(
  store: NoteStore,
  options: WorkspaceOptions = {},
): WorkspaceController {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const autoTitleWords = options.autoTitleWords ?? 6;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultNewId;

  let state: WorkspaceState = {
    notes: [],
    folders: [],
    selectedFolder: null,
    showArchived: false,
    selectedId: null,
    selected: null,
    ready: false,
  };
  /** Every known note, including archived and other folders. */
  let allNotes: ReadonlyArray<NoteSummary> = [];

  const listeners = new Set<() => void>();
  let draft: Note | null = null;
  let draftFolder = "";
  let pending: PendingSave | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (next: WorkspaceState): void => {
    state = next;
    emit();
  };

  const show = (note: Note): void => {
    draft = note;
    allNotes = withSummary(allNotes, summaryOf(note, draftFolder));
    update({
      ...state,
      notes: viewOf(allNotes, state.selectedFolder, state.showArchived),
      selectedId: note.id,
      selected: editorNote(note),
    });
  };

  /** The draft is authoritative while it is open; otherwise read from disk. */
  const currentNote = async (id: string): Promise<IndexedNote | null> => {
    if (draft !== null && draft.id === id) {
      return { note: draft, folder: draftFolder };
    }
    return store.get(id);
  };

  const applySaved = (saved: IndexedNote): void => {
    const isDraft = draft !== null && draft.id === saved.note.id;
    if (isDraft) {
      draft = saved.note;
      draftFolder = saved.folder;
    }
    allNotes = withSummary(allNotes, summaryOf(saved.note, saved.folder));
    update({
      ...state,
      notes: viewOf(allNotes, state.selectedFolder, state.showArchived),
      ...(isDraft
        ? { selectedId: saved.note.id, selected: editorNote(saved.note) }
        : {}),
    });
  };

  const enqueue = (save: PendingSave): void => {
    chain = chain
      .then(() => store.save(save.note, save.folder))
      .then(() => undefined)
      .catch((cause: unknown) => {
        // No save UI exists, so a failed write is only reported to the
        // console. The draft stays in memory and the next edit retries.
        console.warn("Notty could not save a note", cause);
      });
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const save = pending;
    pending = null;
    if (save !== null) enqueue(save);
    await chain;
  };

  const schedule = (note: Note): void => {
    pending = { note, folder: draftFolder };
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  const retitle = (note: Note, body: string): string =>
    note.titleLocked === true
      ? note.title
      : deriveAutoTitle(
          note.created,
          leadingWords(body, autoTitleWords + 4),
          { maxWords: autoTitleWords },
        );

  const createNote = async (): Promise<void> => {
    // Queue the previous draft's save without waiting for disk: capture must
    // not pause behind an unrelated write.
    if (draft !== null) void flush();

    const createdAt = now().toISOString();
    const note: Note = {
      id: newId(),
      title: deriveAutoTitle(createdAt, "", { maxWords: autoTitleWords }),
      created: createdAt,
      modified: createdAt,
      pinned: false,
      archived: false,
      body: "",
    };

    draft = note;
    draftFolder = state.selectedFolder ?? "";
    allNotes = withSummary(allNotes, summaryOf(note, draftFolder));
    update({
      ...state,
      notes: viewOf(allNotes, state.selectedFolder, false),
      selectedId: note.id,
      selected: editorNote(note),
      showArchived: false,
      ready: true,
    });

    // The note exists in the list before this write lands, so the first
    // keystroke has somewhere to go immediately.
    enqueue({ note, folder: draftFolder });
  };

  const selectNote = async (id: string): Promise<void> => {
    if (draft !== null && draft.id === id) return;
    await flush();

    try {
      const found = await store.get(id);
      if (found === null) return;
      draft = found.note;
      draftFolder = found.folder;
      update({
        ...state,
        selectedId: found.note.id,
        selected: editorNote(found.note),
      });
    } catch (cause) {
      console.warn("Notty could not open a note", cause);
    }
  };

  const selectFolder = (folder: string | null): void => {
    update({
      ...state,
      selectedFolder: folder,
      showArchived: false,
      notes: viewOf(allNotes, folder, false),
    });
  };

  const selectArchive = (): void => {
    update({
      ...state,
      selectedFolder: null,
      showArchived: true,
      notes: viewOf(allNotes, null, true),
    });
  };

  const togglePin = async (id: string): Promise<void> => {
    await flush();
    try {
      const found = await currentNote(id);
      if (found === null) return;
      const saved = await store.save(
        { ...found.note, pinned: !found.note.pinned },
        found.folder,
      );
      applySaved(saved);
    } catch (cause) {
      console.warn("Notty could not pin a note", cause);
    }
  };

  const setArchived = async (id: string, archived: boolean): Promise<void> => {
    await flush();
    try {
      const found = await currentNote(id);
      if (found === null || found.note.archived === archived) return;
      const saved = await store.save(
        { ...found.note, archived },
        found.folder,
      );

      // Archive and Unarchive both remove the note from the list the user is
      // looking at, so an open editor for it must close in step.
      const deselect =
        state.selectedId === id && archived !== state.showArchived;
      if (deselect) {
        draft = null;
        draftFolder = "";
      }
      allNotes = withSummary(allNotes, summaryOf(saved.note, saved.folder));
      update({
        ...state,
        notes: viewOf(allNotes, state.selectedFolder, state.showArchived),
        ...(deselect ? { selectedId: null, selected: null } : {}),
      });
    } catch (cause) {
      console.warn("Notty could not archive a note", cause);
    }
  };

  const duplicateNote = async (id: string): Promise<void> => {
    await flush();
    try {
      const found = await currentNote(id);
      if (found === null) return;

      const createdAt = now().toISOString();
      const copy: Note = {
        id: newId(),
        title: found.note.title,
        created: createdAt,
        modified: createdAt,
        pinned: false,
        archived: false,
        ...(found.note.titleLocked === true ? { titleLocked: true } : {}),
        body: found.note.body,
        ...(found.note.extra === undefined ? {} : { extra: found.note.extra }),
      };

      draft = copy;
      draftFolder = found.folder;
      allNotes = withSummary(allNotes, summaryOf(copy, found.folder));
      update({
        ...state,
        notes: viewOf(allNotes, state.selectedFolder, false),
        showArchived: false,
        selectedId: copy.id,
        selected: editorNote(copy),
      });
      enqueue({ note: copy, folder: found.folder });
      await flush();
    } catch (cause) {
      console.warn("Notty could not duplicate a note", cause);
    }
  };

  const createFolder = async (name: string): Promise<void> => {
    const segments = folderSegments(name);
    if (segments === null) return;
    const relative = segments.join("/");
    const folder =
      state.selectedFolder === null
        ? relative
        : `${state.selectedFolder}/${relative}`;

    try {
      await store.createFolder(folder);
      const folders = await store.listFolders();
      update({ ...state, folders: sortedFolders(folders), selectedFolder: folder });
    } catch (cause) {
      console.warn("Notty could not create a folder", cause);
    }
  };

  const renameFolder = async (folder: string, name: string): Promise<void> => {
    const segments = folderSegments(name);
    if (segments === null) return;
    const parent = parentOf(folder);
    const nextFolder = parent.length === 0
      ? segments.join("/")
      : `${parent}/${segments.join("/")}`;
    if (nextFolder === folder) return;

    // Folder operations move files, so any in-flight edit must land first.
    await flush();
    try {
      await store.renameFolder(folder, nextFolder);
      const [folders, notes] = await Promise.all([
        store.listFolders(),
        store.list({ includeArchived: true }),
      ]);
      const selectedFolder =
        state.selectedFolder === null
          ? null
          : remapFolder(state.selectedFolder, folder, nextFolder);
      draftFolder = remapFolder(draftFolder, folder, nextFolder);
      allNotes = sorted(notes);
      update({
        ...state,
        folders: sortedFolders(folders),
        notes: viewOf(allNotes, selectedFolder, state.showArchived),
        selectedFolder,
      });
    } catch (cause) {
      console.warn("Notty could not rename a folder", cause);
    }
  };

  const deleteFolder = async (folder: string): Promise<void> => {
    await flush();
    try {
      await store.deleteFolder(folder);
      const [folders, notes] = await Promise.all([
        store.listFolders(),
        store.list({ includeArchived: true }),
      ]);
      const removedDraft = draft !== null && isInside(draftFolder, folder);
      const removedSelection =
        state.selectedFolder !== null && isInside(state.selectedFolder, folder);
      if (removedDraft) {
        draft = null;
        draftFolder = "";
      }
      const selectedFolder = removedSelection
        ? parentOf(folder) || null
        : state.selectedFolder;
      allNotes = sorted(notes);
      update({
        ...state,
        folders: sortedFolders(folders),
        notes: viewOf(allNotes, selectedFolder, state.showArchived),
        selectedFolder,
        ...(removedDraft ? { selectedId: null, selected: null } : {}),
      });
    } catch (cause) {
      console.warn("Notty could not delete a folder", cause);
    }
  };

  const moveNote = async (id: string, folder: string): Promise<void> => {
    await flush();
    try {
      const source = draft?.id === id ? draft : (await store.get(id))?.note;
      if (source === undefined) return;
      const saved = await store.save(source, folder);

      if (draft?.id === id) {
        draft = saved.note;
        draftFolder = saved.folder;
        show(saved.note);
      } else {
        allNotes = sorted(await store.list({ includeArchived: true }));
        update({
          ...state,
          notes: viewOf(allNotes, state.selectedFolder, state.showArchived),
        });
      }
    } catch (cause) {
      console.warn("Notty could not move a note", cause);
    }
  };

  const setBody = (body: string): void => {
    if (draft === null) return;
    const note: Note = {
      ...draft,
      body,
      title: retitle(draft, body),
      modified: now().toISOString(),
    };
    show(note);
    schedule(note);
  };

  const setTitle = (title: string): void => {
    if (draft === null) return;
    const note: Note = {
      ...draft,
      title,
      titleLocked: true,
      modified: now().toISOString(),
    };
    show(note);
    schedule(note);
  };

  const load = async (): Promise<void> => {
    try {
      const [summaries, folders] = await Promise.all([
        store.list({ includeArchived: true }),
        store.listFolders(),
      ]);
      const loaded = sorted(summaries);
      const folderList = sortedFolders(folders);

      if (draft !== null) {
        // The user created or opened a note while the list was loading.
        // Keep their selection and merge the optimistic list with disk.
        const known = new Set(allNotes.map((note) => note.id));
        allNotes = sorted([
          ...loaded.filter((note) => !known.has(note.id)),
          ...allNotes,
        ]);
        update({
          ...state,
          notes: viewOf(allNotes, state.selectedFolder, state.showArchived),
          folders: folderList,
          ready: true,
        });
        return;
      }

      allNotes = loaded;
      const displayed = viewOf(
        allNotes,
        state.selectedFolder,
        state.showArchived,
      );
      update({ ...state, notes: displayed, folders: folderList, ready: true });

      const first = displayed[0];
      if (first === undefined) return;
      const found = await store.get(first.id);
      if (found === null) return;
      draft = found.note;
      draftFolder = found.folder;
      update({
        ...state,
        selectedId: found.note.id,
        selected: editorNote(found.note),
      });
    } catch (cause) {
      console.warn("Notty could not read the note list", cause);
      update({ ...state, ready: true });
    } finally {
      markReady();
    }
  };

  void load();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready,
    createNote,
    selectNote,
    selectFolder,
    selectArchive,
    togglePin,
    setArchived,
    duplicateNote,
    createFolder,
    renameFolder,
    deleteFolder,
    moveNote,
    setBody,
    setTitle,
    flush,
    dispose: () => {
      void flush();
    },
  };
}
