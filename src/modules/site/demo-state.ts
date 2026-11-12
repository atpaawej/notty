/**
 * Private: the state behind the interactive hero demo.
 *
 * The demo is a small, deliberately fake slice of the real workspace. Keeping
 * selection, filtering and checklist state in pure functions means the page
 * can be tested without a DOM, and the React surface stays a rendering layer.
 */

export type DemoFolder = "work" | "personal";
export type DemoView = "all" | "archive";

export interface DemoChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
}

export interface DemoTable {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export interface DemoAttachment {
  readonly name: string;
  readonly meta: string;
}

export interface DemoNote {
  readonly id: string;
  readonly title: string;
  readonly folder: DemoFolder;
  readonly created: string;
  readonly modified: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  /** On-disk path relative to the vault root. */
  readonly path: string;
  readonly intro: string;
  readonly checklist: ReadonlyArray<DemoChecklistItem>;
  readonly table?: DemoTable;
  readonly attachment?: DemoAttachment;
}

export interface DemoState {
  readonly view: DemoView;
  readonly folder: DemoFolder | null;
  readonly query: string;
  readonly noteId: string | null;
  /** Checklist overrides, keyed by `noteId/itemId`. */
  readonly checks: Readonly<Record<string, boolean>>;
}

const notes: ReadonlyArray<DemoNote> = [
  {
    id: "rfc-sync",
    title: "RFC: Sync engine",
    folder: "work",
    created: "Oct 12",
    modified: "2m ago",
    pinned: true,
    archived: false,
    path: "work/rfc-sync--4f2a.md",
    intro:
      "Two writers, one vault: the desktop window and the CLI. SQLite runs in WAL mode so short overlaps wait instead of failing.",
    checklist: [
      { id: "file-first", label: "Write the file before the Index row", done: true },
      { id: "reconcile", label: "Cover open-note reconciliation", done: false },
      { id: "wal", label: "Measure a WAL overlap under load", done: false },
    ],
    table: {
      columns: ["Path", "Owner", "Latency"],
      rows: [
        ["save", "note-index", "1.4ms"],
        ["syncFile", "vault watcher", "50 ms"],
      ],
    },
    attachment: { name: "attachments/7d1c9e4a.png", meta: "PNG · 148 KB" },
  },
  {
    id: "groceries",
    title: "Groceries",
    folder: "personal",
    created: "Oct 11",
    modified: "18m ago",
    pinned: true,
    archived: false,
    path: "personal/groceries--9c1d.md",
    intro: "Market run after the standup. The good bread is on the corner shelf.",
    checklist: [
      { id: "milk", label: "Milk", done: false },
      { id: "eggs", label: "Eggs", done: false },
      { id: "bread", label: "The good bread", done: true },
    ],
  },
  {
    id: "weekly",
    title: "Weekly review",
    folder: "work",
    created: "Oct 10",
    modified: "1h ago",
    pinned: false,
    archived: false,
    path: "work/weekly-review--a7b3.md",
    intro:
      "What moved, what stalled, and the one thing worth finishing before Friday.",
    checklist: [
      { id: "ship", label: "Ship the search fix", done: true },
      { id: "review", label: "Review the Trash retention sweep", done: false },
      { id: "write", label: "Write the next RFC", done: false },
    ],
    table: {
      columns: ["Area", "State"],
      rows: [
        ["Capture", "shipped"],
        ["Index", "in review"],
      ],
    },
  },
  {
    id: "reading",
    title: "Reading list",
    folder: "personal",
    created: "Oct 8",
    modified: "Yesterday",
    pinned: false,
    archived: false,
    path: "personal/reading-list--e5f8.md",
    intro: "Books that survived the first ten pages.",
    checklist: [
      { id: "paper", label: "The Design of Everyday Things", done: true },
      { id: "notes", label: "How to Take Smart Notes", done: false },
    ],
  },
  {
    id: "release",
    title: "Release 0.2.8",
    folder: "work",
    created: "Oct 28",
    modified: "Oct 28",
    pinned: false,
    archived: true,
    path: "work/release-0-2-8--1b7e.md",
    intro: "Tarball, .deb, signatures, and the release notes.",
    checklist: [
      { id: "deb", label: "Build the .deb", done: true },
      { id: "tar", label: "Build the tarball", done: true },
      { id: "notes", label: "Publish the release notes", done: true },
    ],
  },
];

export const demoFolders: ReadonlyArray<DemoFolder> = ["work", "personal"];

export const demoNotes = notes;

export const createDemoState = (): DemoState => ({
  view: "all",
  folder: null,
  query: "",
  noteId: "rfc-sync",
  checks: {},
});

export const visibleDemoNotes = (state: DemoState): ReadonlyArray<DemoNote> => {
  const query = state.query.trim().toLowerCase();
  const scoped =
    state.view === "archive"
      ? notes.filter((note) => note.archived)
      : notes.filter(
          (note) =>
            !note.archived &&
            (state.folder === null || note.folder === state.folder),
        );

  if (query.length === 0) return scoped;

  return scoped.filter((note) => {
    const haystack = [
      note.title,
      note.intro,
      note.folder,
      ...note.checklist.map((item) => item.label),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
};

export const selectedDemoNote = (state: DemoState): DemoNote | null =>
  notes.find((note) => note.id === state.noteId) ?? null;

/** Keep the selection on-screen after a filter changes. */
const withVisibleSelection = (state: DemoState): DemoState => {
  const visible = visibleDemoNotes(state);
  if (visible.some((note) => note.id === state.noteId)) return state;
  return { ...state, noteId: visible[0]?.id ?? null };
};

export const selectDemoFolder = (
  state: DemoState,
  folder: DemoFolder | null,
): DemoState =>
  withVisibleSelection({ ...state, view: "all", folder, query: "" });

export const selectDemoArchive = (state: DemoState): DemoState =>
  withVisibleSelection({
    ...state,
    view: "archive",
    folder: null,
    query: "",
  });

export const selectDemoNote = (state: DemoState, noteId: string): DemoState =>
  state.noteId === noteId ? state : { ...state, noteId };

export const setDemoQuery = (state: DemoState, query: string): DemoState =>
  withVisibleSelection({ ...state, query });

const checkKey = (noteId: string, itemId: string): string =>
  `${noteId}/${itemId}`;

export const isDemoChecked = (
  state: DemoState,
  note: DemoNote,
  item: DemoChecklistItem,
): boolean => state.checks[checkKey(note.id, item.id)] ?? item.done;

export const toggleDemoCheck = (
  state: DemoState,
  note: DemoNote,
  item: DemoChecklistItem,
): DemoState => {
  const key = checkKey(note.id, item.id);
  return {
    ...state,
    checks: {
      ...state.checks,
      [key]: !isDemoChecked(state, note, item),
    },
  };
};

export const demoListTitle = (state: DemoState): string =>
  state.view === "archive" ? "Archive" : (state.folder ?? "All Notes");
