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
  FileSyncResult,
  IndexedNote,
  NoteSummary,
} from "../note-index";
import type { VaultChangeEvent } from "../vault";

/** The persistence surface the workspace needs. */
export interface NoteStore {
  readonly list: (options?: {
    /** Include notes hidden from the normal list by the Archive flag. */
    readonly includeArchived?: boolean;
  }) => Promise<ReadonlyArray<NoteSummary>>;
  readonly get: (id: string) => Promise<IndexedNote | null>;
  readonly save: (note: Note, folder: string) => Promise<IndexedNote>;
  /** Reconcile one externally changed vault file into the index. */
  readonly syncFile: (relativePath: string) => Promise<FileSyncResult>;
  /**
   * Realtime vault changes. Omitted by runtimes without a watcher; the
   * workspace then behaves exactly as it did before #74.
   */
  readonly watchVault?: (
    onChange: (event: VaultChangeEvent) => Promise<void> | void,
  ) => Promise<() => void>;
  /** Full-text search over note titles and bodies, from the index only. */
  readonly search: (
    query: string,
    limit?: number,
  ) => Promise<ReadonlyArray<NoteSummary>>;
  /** Every folder as a vault-relative POSIX path, sorted. */
  readonly listFolders: () => Promise<ReadonlyArray<string>>;
  readonly createFolder: (folder: string) => Promise<void>;
  readonly renameFolder: (folder: string, nextFolder: string) => Promise<void>;
  readonly deleteFolder: (folder: string) => Promise<void>;
  /** Notes currently in the vault's Trash, most recently modified first. */
  readonly listTrash: () => Promise<ReadonlyArray<NoteSummary>>;
  /** Move a note into the Trash. It leaves the normal list immediately. */
  readonly trashNote: (id: string) => Promise<void>;
  /** Put a trashed note back in its original folder. */
  readonly restoreNote: (id: string) => Promise<IndexedNote | null>;
  /** Permanently remove one note from the Trash. */
  readonly purgeNote: (id: string) => Promise<void>;
}

/** The part of a note the editor displays. */
export interface EditorNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly titleLocked: boolean;
}

export type WorkspaceView = "all" | "archive" | "trash";

export interface WorkspaceState {
  /** Note list, last touched first (pinned, then modified, then id). */
  readonly notes: ReadonlyArray<NoteSummary>;
  /** Folder tree as vault-relative POSIX paths. */
  readonly folders: ReadonlyArray<string>;
  /** `null` means All Notes; otherwise an exact folder path. */
  readonly selectedFolder: string | null;
  /** Which library section the note list shows. */
  readonly selectedView: WorkspaceView;
  /** True while the note list shows archived notes instead of active ones. */
  readonly showArchived: boolean;
  readonly selectedId: string | null;
  readonly selected: EditorNote | null;
  /** The text currently in the search field; `""` means not searching. */
  readonly searchQuery: string;
  /** Index matches for the current query, newest query wins. */
  readonly searchResults: ReadonlyArray<NoteSummary>;
  /** True between a query change and its debounced result. */
  readonly searching: boolean;
  /** False while the initial list is still being read. */
  readonly ready: boolean;
}

export interface WorkspaceOptions {
  /** Edit-to-save delay. The product budget is 300–500 ms. */
  readonly debounceMs?: number;
  /** Search-as-you-type delay. Defaults to 150 ms. */
  readonly searchDebounceMs?: number;
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
  /** Show trashed notes, restorable for 30 days. */
  readonly selectTrash: () => Promise<void>;
  /** Set the search text; results arrive after the search debounce. */
  readonly setSearchQuery: (query: string) => void;
  /** Pin or unpin a note with one action. */
  readonly togglePin: (id: string) => Promise<void>;
  /** Hide a note from the normal list, or bring it back. */
  readonly setArchived: (id: string, archived: boolean) => Promise<void>;
  /** Copy a note into the same folder with a new identity and timestamps. */
  readonly duplicateNote: (id: string) => Promise<void>;
  /** Create a folder (nested under the selection) and select it. */
  readonly createFolder: (name: string) => Promise<string | null>;
  /** Rename a folder in place, keeping its notes. */
  readonly renameFolder: (folder: string, name: string) => Promise<void>;
  /** Delete a folder and the notes beneath it. */
  readonly deleteFolder: (folder: string) => Promise<void>;
  /** Move a note into a folder; `""` is the vault root. */
  readonly moveNote: (id: string, folder: string) => Promise<void>;
  /** Move a note into the Trash. */
  readonly trashNote: (id: string) => Promise<void>;
  /** Restore a trashed note to its original folder. */
  readonly restoreNote: (id: string) => Promise<void>;
  /** Permanently delete one trashed note. */
  readonly purgeNote: (id: string) => Promise<void>;
  /** Permanently delete every trashed note. */
  readonly emptyTrash: () => Promise<void>;
  /** Update the body; auto-title follows unless the title is user-owned. */
  readonly setBody: (markdown: string) => void;
  /**
   * Record whether the editor holds keystrokes not yet serialized. While
   * true, an external change to the open note never overwrites them.
   */
  readonly setEditing: (dirty: boolean) => void;
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
const DEFAULT_SEARCH_DEBOUNCE_MS = 150;

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

/** The notes the current view shows: one folder, the archive, or the Trash. */
const notesForView = (
  view: WorkspaceView,
  notes: ReadonlyArray<NoteSummary>,
  selectedFolder: string | null,
  trash: ReadonlyArray<NoteSummary>,
): ReadonlyArray<NoteSummary> => {
  if (view === "trash") return trash;
  if (view === "archive") return notes.filter((note) => note.archived);
  return notes.filter(
    (note) =>
      !note.archived &&
      (selectedFolder === null || note.folder === selectedFolder),
  );
};

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

const compareSummaryByModified = (
  left: NoteSummary,
  right: NoteSummary,
): number => {
  if (left.modified !== right.modified) {
    return left.modified < right.modified ? 1 : -1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

export function createWorkspace(
  store: NoteStore,
  options: WorkspaceOptions = {},
): WorkspaceController {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const searchDebounceMs =
    options.searchDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;
  const autoTitleWords = options.autoTitleWords ?? 6;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultNewId;

  let state: WorkspaceState = {
    notes: [],
    folders: [],
    selectedFolder: null,
    selectedView: "all",
    showArchived: false,
    selectedId: null,
    selected: null,
    searchQuery: "",
    searchResults: [],
    searching: false,
    ready: false,
  };
  /** Every known note, including archived and other folders. */
  let allNotes: ReadonlyArray<NoteSummary> = [];
  /** Every note currently in the Trash. */
  let trashNotes: ReadonlyArray<NoteSummary> = [];

  const listeners = new Set<() => void>();
  let draft: Note | null = null;
  let draftFolder = "";
  let pending: PendingSave | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;
  let chain: Promise<void> = Promise.resolve();
  /** True between a keystroke and the editor's serialization debounce. */
  let editorDirty = false;
  let disposed = false;
  let stopWatching: (() => void) | null = null;
  /** Reconciles vault events one at a time, in arrival order. */
  let reconcileChain: Promise<void> = Promise.resolve();

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
      notes: notesForView(
        state.selectedView,
        allNotes,
        state.selectedFolder,
        trashNotes,
      ),
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
      notes: notesForView(
        state.selectedView,
        allNotes,
        state.selectedFolder,
        trashNotes,
      ),
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

  /**
   * Queue the current edit without waiting for disk. Navigation uses this so
   * opening the next note never pauses behind the previous note's write.
   */
  const flushInBackground = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const save = pending;
    pending = null;
    if (save !== null) enqueue(save);
  };

  const sameFolders = (
    left: ReadonlyArray<string>,
    right: ReadonlyArray<string>,
  ): boolean =>
    left.length === right.length &&
    left.every((folder, index) => folder === right[index]);

  const refreshFolders = async (): Promise<void> => {
    try {
      const folders = sortedFolders(await store.listFolders());
      if (disposed || sameFolders(folders, state.folders)) return;
      update({ ...state, folders });
    } catch (cause) {
      console.warn("Notty could not refresh folders", cause);
    }
  };

  /** True while the open buffer owns keystrokes an external change must not clobber. */
  const bufferIsDirty = (id: string): boolean =>
    draft?.id === id &&
    (editorDirty || (pending !== null && pending.note.id === id));

  /**
   * Apply one vault event. The index reconciles a single file; the workspace
   * then updates just that row, leaving every other note and the editor
   * untouched unless the changed file is the one on screen.
   */
  const applyExternalChange = async (
    event: VaultChangeEvent,
  ): Promise<void> => {
    if (disposed) return;

    if (event.isDirectory === true) {
      await refreshFolders();
      return;
    }

    const result = await store.syncFile(event.path);
    // `unchanged` is Notty's own auto-save echo: no SQL ran, so no render.
    if (result.status === "ignored" || result.status === "unchanged") return;

    if (result.status === "removed") {
      allNotes = allNotes.filter((note) => note.id !== result.id);
      trashNotes = trashNotes.filter((note) => note.id !== result.id);
      const wasOpen = draft !== null && draft.id === result.id;
      if (wasOpen) {
        draft = null;
        draftFolder = "";
      }
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
        searchResults: state.searchResults.filter(
          (note) => note.id !== result.id,
        ),
        ...(wasOpen ? { selectedId: null, selected: null } : {}),
      });
      await refreshFolders();
      return;
    }

    const summary = summaryOf(result.note.note, result.note.folder);
    const isOpen = draft !== null && draft.id === summary.id;

    // A dirty buffer wins in memory. The next auto-save writes the user's
    // keystrokes over the external version, so the two never interleave.
    if (isOpen && bufferIsDirty(summary.id)) return;

    allNotes = withSummary(allNotes, summary);
    const searchResults = state.searchResults.some(
      (note) => note.id === summary.id,
    )
      ? withSummary(state.searchResults, summary)
      : state.searchResults;

    if (isOpen && draft !== null) {
      draft = result.note.note;
      draftFolder = result.note.folder;
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
        searchResults,
        selectedId: summary.id,
        selected: editorNote(result.note.note),
      });
    } else {
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
        searchResults,
      });
    }

    // A note arriving in a folder the sidebar has not seen means an external
    // folder appeared. Refreshing only in that case keeps the common update
    // path free of a directory walk.
    if (summary.folder.length > 0 && !state.folders.includes(summary.folder)) {
      await refreshFolders();
    }
  };

  const subscribeToVault = async (): Promise<void> => {
    if (store.watchVault === undefined) return;
    try {
      const stop = await store.watchVault((event) => {
        reconcileChain = reconcileChain
          .then(() => applyExternalChange(event))
          .catch((cause: unknown) => {
            console.warn("Notty could not apply a vault change", cause);
          });
      });
      if (disposed) {
        stop();
        return;
      }
      stopWatching = stop;
    } catch (cause) {
      // A watcher that cannot start must not stop the app from opening; the
      // startup rebuild still makes the index correct.
      console.warn("Notty could not watch the vault", cause);
    }
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
      : deriveAutoTitle(note.created, body, { maxWords: autoTitleWords });

  const createNote = async (): Promise<void> => {
    // A captured note should be visible immediately, not hidden behind an
    // existing search result list.
    if (state.searchQuery.length > 0) setSearchQuery("");
    // Queue the previous draft's save without waiting for disk: capture must
    // not pause behind an unrelated write.
    if (draft !== null) flushInBackground();
    editorDirty = false;

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
      notes: notesForView("all", allNotes, state.selectedFolder, trashNotes),
      selectedId: note.id,
      selected: editorNote(note),
      selectedView: "all",
      showArchived: false,
      ready: true,
    });

    // The note exists in the list before this write lands, so the first
    // keystroke has somewhere to go immediately.
    enqueue({ note, folder: draftFolder });
  };

  const selectNote = async (id: string): Promise<void> => {
    // Trashed notes are not openable; the list only offers restore and purge.
    if (state.selectedView === "trash") return;
    if (draft !== null && draft.id === id) return;
    // The previous note persists in the background; opening the clicked note
    // never waits on disk I/O.
    flushInBackground();
    editorDirty = false;

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
    if (state.searchQuery.length > 0) setSearchQuery("");
    update({
      ...state,
      selectedFolder: folder,
      selectedView: "all",
      showArchived: false,
      notes: notesForView("all", allNotes, folder, trashNotes),
    });
  };

  const selectArchive = (): void => {
    if (state.searchQuery.length > 0) setSearchQuery("");
    update({
      ...state,
      selectedFolder: null,
      selectedView: "archive",
      showArchived: true,
      notes: notesForView("archive", allNotes, null, trashNotes),
    });
  };

  const selectTrash = async (): Promise<void> => {
    if (state.searchQuery.length > 0) setSearchQuery("");
    await flush();
    // The editor is for active notes; opening the Trash closes the draft so a
    // hidden note cannot keep saving in the background.
    draft = null;
    draftFolder = "";
    editorDirty = false;
    try {
      trashNotes = [...(await store.listTrash())].sort(compareSummaryByModified);
      update({
        ...state,
        selectedFolder: null,
        selectedView: "trash",
        showArchived: false,
        notes: trashNotes,
        selectedId: null,
        selected: null,
      });
    } catch (cause) {
      console.warn("Notty could not read the Trash", cause);
      update({
        ...state,
        selectedFolder: null,
        selectedView: "trash",
        showArchived: false,
        notes: [],
        selectedId: null,
        selected: null,
      });
    }
  };

  const setSearchQuery = (query: string): void => {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    searchGeneration += 1;
    const generation = searchGeneration;
    const trimmed = query.trim();

    if (trimmed.length === 0) {
      update({
        ...state,
        searchQuery: query,
        searchResults: [],
        searching: false,
      });
      return;
    }

    update({ ...state, searchQuery: query, searching: true });
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void (async () => {
        try {
          const results = await store.search(trimmed);
          // A later keystroke or a cleared field owns the result slot now.
          if (generation !== searchGeneration) return;
          update({ ...state, searchResults: results, searching: false });
        } catch (cause) {
          if (generation !== searchGeneration) return;
          console.warn("Notty could not search notes", cause);
          update({ ...state, searchResults: [], searching: false });
        }
      })();
    }, searchDebounceMs);
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
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
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
        notes: notesForView("all", allNotes, state.selectedFolder, trashNotes),
        selectedView: "all",
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

  const createFolder = async (name: string): Promise<string | null> => {
    const segments = folderSegments(name);
    if (segments === null) return null;
    const relative = segments.join("/");
    const folder =
      state.selectedFolder === null
        ? relative
        : `${state.selectedFolder}/${relative}`;

    try {
      await store.createFolder(folder);
      const folders = await store.listFolders();
      update({
        ...state,
        folders: sortedFolders(folders),
        selectedFolder: folder,
        selectedView: "all",
        showArchived: false,
        notes: notesForView("all", allNotes, folder, trashNotes),
      });
      return folder;
    } catch (cause) {
      console.warn("Notty could not create a folder", cause);
      return null;
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
        notes: notesForView(
          state.selectedView,
          allNotes,
          selectedFolder,
          trashNotes,
        ),
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
        notes: notesForView(
          state.selectedView,
          allNotes,
          selectedFolder,
          trashNotes,
        ),
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
          notes: notesForView(
            state.selectedView,
            allNotes,
            state.selectedFolder,
            trashNotes,
          ),
        });
      }
    } catch (cause) {
      console.warn("Notty could not move a note", cause);
    }
  };

  const trashNote = async (id: string): Promise<void> => {
    await flush();
    try {
      await store.trashNote(id);
      allNotes = allNotes.filter((note) => note.id !== id);
      if (draft !== null && draft.id === id) {
        draft = null;
        draftFolder = "";
      }
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
        searchResults: state.searchResults.filter((note) => note.id !== id),
        ...(state.selectedId === id ? { selectedId: null, selected: null } : {}),
      });
      if (state.selectedView === "trash") {
        trashNotes = [...(await store.listTrash())].sort(compareSummaryByModified);
        update({ ...state, notes: trashNotes });
      }
    } catch (cause) {
      console.warn("Notty could not trash a note", cause);
    }
  };

  const restoreNote = async (id: string): Promise<void> => {
    try {
      const restored = await store.restoreNote(id);
      trashNotes = trashNotes.filter((note) => note.id !== id);
      if (restored !== null) {
        allNotes = withSummary(
          allNotes,
          summaryOf(restored.note, restored.folder),
        );
      }
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
      });
      if (state.selectedView === "trash") {
        trashNotes = [...(await store.listTrash())].sort(compareSummaryByModified);
        update({ ...state, notes: trashNotes });
      }
    } catch (cause) {
      console.warn("Notty could not restore a note", cause);
    }
  };

  const purgeNote = async (id: string): Promise<void> => {
    try {
      await store.purgeNote(id);
      trashNotes = trashNotes.filter((note) => note.id !== id);
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
        searchResults: state.searchResults.filter((note) => note.id !== id),
      });
    } catch (cause) {
      console.warn("Notty could not delete a note permanently", cause);
    }
  };

  const emptyTrash = async (): Promise<void> => {
    try {
      const trashed = await store.listTrash();
      for (const note of trashed) {
        await store.purgeNote(note.id);
      }
      trashNotes = [];
      update({
        ...state,
        notes: notesForView(
          state.selectedView,
          allNotes,
          state.selectedFolder,
          trashNotes,
        ),
      });
    } catch (cause) {
      console.warn("Notty could not empty the Trash", cause);
    }
  };

  const setBody = (body: string): void => {
    if (draft === null) return;
    editorDirty = false;
    const note: Note = {
      ...draft,
      body,
      title: retitle(draft, body),
      modified: now().toISOString(),
    };
    show(note);
    schedule(note);
  };

  const setEditing = (dirty: boolean): void => {
    editorDirty = dirty;
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
          notes: notesForView(
            state.selectedView,
            allNotes,
            state.selectedFolder,
            trashNotes,
          ),
          folders: folderList,
          ready: true,
        });
        return;
      }

      allNotes = loaded;
      const displayed = notesForView(
        state.selectedView,
        allNotes,
        state.selectedFolder,
        trashNotes,
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
  void subscribeToVault();

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
    selectTrash,
    setSearchQuery,
    togglePin,
    setArchived,
    duplicateNote,
    createFolder,
    renameFolder,
    deleteFolder,
    moveNote,
    trashNote,
    restoreNote,
    purgeNote,
    emptyTrash,
    setBody,
    setTitle,
    setEditing,
    flush,
    dispose: () => {
      disposed = true;
      stopWatching?.();
      stopWatching = null;
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      void flush();
    },
  };
}
