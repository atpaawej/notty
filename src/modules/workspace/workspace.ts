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
  readonly list: () => Promise<ReadonlyArray<NoteSummary>>;
  readonly get: (id: string) => Promise<IndexedNote | null>;
  readonly save: (note: Note, folder: string) => Promise<IndexedNote>;
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
    selectedId: null,
    selected: null,
    ready: false,
  };

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
    update({
      ...state,
      notes: withSummary(state.notes, summaryOf(note, draftFolder)),
      selectedId: note.id,
      selected: editorNote(note),
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
    if (draft !== null) await flush();

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
    draftFolder = "";
    update({
      ...state,
      notes: withSummary(state.notes, summaryOf(note, "")),
      selectedId: note.id,
      selected: editorNote(note),
      ready: true,
    });

    // The note exists in the list before this write lands, so the first
    // keystroke has somewhere to go immediately.
    enqueue({ note, folder: "" });
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
      const loaded = sorted(await store.list());
      if (draft !== null) {
        // The user created or opened a note while the list was loading.
        // Keep their selection and merge the optimistic list with disk.
        const known = new Set(state.notes.map((note) => note.id));
        update({
          ...state,
          notes: sorted([
            ...loaded.filter((note) => !known.has(note.id)),
            ...state.notes,
          ]),
          ready: true,
        });
        return;
      }

      update({ ...state, notes: loaded, ready: true });

      const first = loaded[0];
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
    setBody,
    setTitle,
    flush,
    dispose: () => {
      void flush();
    },
  };
}
