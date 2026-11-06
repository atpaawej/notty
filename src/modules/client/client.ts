/**
 * Private: the NottyClient implementation.
 *
 * Composes the vault, note-file and note-index modules behind one Promise
 * surface. Effect wiring, SQLite statements and typed errors stop here.
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import { deriveAutoTitle, type Note } from "../note-file";
import {
  NoteIndex,
  noteIndexNodeLayer,
  type IndexedNote,
  type NoteIndexError,
  type NoteSummary,
} from "../note-index";
import {
  resolveVaultPaths,
  Vault,
  vaultNodeLayer,
  type VaultError,
  type VaultPaths,
} from "../vault";
import {
  NottyClientError,
  type CreateNoteInput,
  type EditNoteInput,
  type ListNotesOptions,
  type NottyClient,
  type NottyNote,
  type RenameNoteOptions,
  type SearchNotesOptions,
} from "./service";

export interface NottyClientOptions {
  /** Absolute vault root. Defaults to the XDG data location. */
  readonly root?: string;
  /** Explicit paths, mainly for tests that already resolved a vault. */
  readonly paths?: VaultPaths;
  /**
   * Absolute SQLite file path, `:memory:` or `null` for in-memory SQLite.
   * Defaults to `<vault root>/notty.db`.
   */
  readonly database?: string | null;
  /** Clock seam. Defaults to the system clock. */
  readonly now?: () => Date;
  /** Identity seam. Defaults to `crypto.randomUUID`. */
  readonly newId?: () => string;
  /** Runs after the index closes; the in-memory adapter removes its vault. */
  readonly cleanup?: () => Promise<void>;
}

type ClientEffect<A> = Effect.Effect<
  A,
  VaultError | NoteIndexError,
  Vault | NoteIndex
>;

const DEFAULT_AUTO_TITLE_WORDS = 6;

const defaultNewId = (): string => {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const pathsAt = (root: string): VaultPaths => {
  const base = root.replace(/\/+$/, "");
  return {
    root: base,
    attachments: `${base}/attachments`,
    internal: `${base}/.notty`,
    trash: `${base}/.trash`,
  };
};

const resolveDefaultPaths = async (): Promise<VaultPaths> => {
  const { homedir } = await import("node:os");
  return resolveVaultPaths(process.env.XDG_DATA_HOME, homedir());
};

const ensureDirectories = async (paths: VaultPaths): Promise<void> => {
  const { mkdir } = await import("node:fs/promises");
  for (const path of [
    paths.root,
    paths.attachments,
    paths.internal,
    paths.trash,
  ]) {
    await mkdir(path, { recursive: true });
  }
};

interface NoteChanges {
  readonly title?: string;
  readonly body?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly titleLocked?: boolean;
  readonly modified?: string;
}

/** Rebuild a note without dropping the fields this build does not own. */
const cloneNote = (note: Note, changes: NoteChanges): Note => {
  const titleLocked =
    changes.titleLocked === undefined
      ? note.titleLocked
      : changes.titleLocked;
  return {
    id: note.id,
    title: changes.title ?? note.title,
    created: note.created,
    modified: changes.modified ?? note.modified,
    pinned: changes.pinned ?? note.pinned,
    archived: changes.archived ?? note.archived,
    ...(titleLocked === true ? { titleLocked: true } : {}),
    body: changes.body ?? note.body,
    ...(note.extra === undefined ? {} : { extra: note.extra }),
  };
};

export const createNottyClient = async (
  options: NottyClientOptions = {},
): Promise<NottyClient> => {
  const paths = options.paths ?? (
    options.root === undefined
      ? await resolveDefaultPaths()
      : pathsAt(options.root)
  );
  const root = paths.root.replace(/\/+$/, "");
  const database =
    options.database === null || options.database === ":memory:"
      ? ":memory:"
      : (options.database ?? `${root}/notty.db`);

  await ensureDirectories(paths);

  const runtime = ManagedRuntime.make(
    Layer.merge(
      noteIndexNodeLayer({ root, database }),
      vaultNodeLayer(paths),
    ),
  );
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultNewId;

  const run = async <A>(
    operation: string,
    effect: () => ClientEffect<A>,
  ): Promise<A> => {
    try {
      const outcome = await runtime.runPromise(
        Effect.match(effect(), {
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      );
      if (!outcome.ok) throw new NottyClientError(operation, outcome.error);
      return outcome.value;
    } catch (cause) {
      if (cause instanceof NottyClientError) throw cause;
      throw new NottyClientError(operation, cause);
    }
  };

  const readNote = (id: string): Promise<NottyNote | null> =>
    run("read the note", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* index.get(id);
      }));

  const requireNote = async (
    operation: string,
    id: string,
  ): Promise<NottyNote> => {
    const found = await readNote(id);
    if (found === null) {
      throw new NottyClientError(operation, new Error(`Note not found: ${id}`));
    }
    return found;
  };

  const saveNote = (note: Note, folder: string): Promise<NottyNote> =>
    run("save the note", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* index.save(note, folder);
      }));

  const updateNote = async (
    operation: string,
    id: string,
    update: (note: Note) => Note,
  ): Promise<NottyNote> => {
    const found = await requireNote(operation, id);
    return saveNote(update(found.note), found.folder);
  };

  const listNotes = async (
    listOptions: ListNotesOptions = {},
  ): Promise<ReadonlyArray<NoteSummary>> => {
    const notes = await run("list the notes", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* index.list({
          ...(listOptions.folder === undefined
            ? {}
            : { folder: listOptions.folder }),
          ...(listOptions.pinned === undefined
            ? {}
            : { pinned: listOptions.pinned }),
          ...(listOptions.archived === undefined
            ? { includeArchived: listOptions.includeArchived === true }
            : { archived: listOptions.archived }),
        });
      }));
    return limitNotes(notes, listOptions.limit);
  };

  const searchNotes = async (
    query: string,
    searchOptions: SearchNotesOptions = {},
  ): Promise<ReadonlyArray<NoteSummary>> => {
    const notes = await run("search the notes", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* index.search(query, searchOptions.limit);
      }));

    const filtered = notes.filter(
      (note) =>
        (searchOptions.includeArchived === true || !note.archived) &&
        (searchOptions.folder === undefined ||
          note.folder === searchOptions.folder),
    );
    return limitNotes(filtered, searchOptions.limit);
  };

  const createNote = async (
    input: CreateNoteInput = {},
  ): Promise<NottyNote> => {
    const createdAt = now().toISOString();
    const body = input.body ?? "";
    const hasTitle =
      input.title !== undefined && input.title.trim().length > 0;
    const title = hasTitle
      ? (input.title as string)
      : deriveAutoTitle(createdAt, body, {
          maxWords: DEFAULT_AUTO_TITLE_WORDS,
        });

    return saveNote(
      {
        id: newId(),
        title,
        created: createdAt,
        modified: createdAt,
        pinned: false,
        archived: false,
        ...(hasTitle ? { titleLocked: true } : {}),
        body,
      },
      input.folder ?? "",
    );
  };

  const appendToNote = async (
    id: string,
    text: string,
  ): Promise<NottyNote> =>
    updateNote("append to the note", id, (note) => {
      if (text.length === 0) return note;
      const separator =
        note.body.length === 0 || note.body.endsWith("\n") ? "" : "\n";
      return cloneNote(note, {
        body: `${note.body}${separator}${text}`,
        modified: now().toISOString(),
      });
    });

  const editNote = async (
    id: string,
    targetOrEdit: string | EditNoteInput,
    replacement?: string,
  ): Promise<NottyNote> => {
    const target =
      typeof targetOrEdit === "string" ? targetOrEdit : targetOrEdit.target;
    const replacementText =
      typeof targetOrEdit === "string"
        ? (replacement ?? "")
        : targetOrEdit.replacement;

    if (target.length === 0) {
      throw new NottyClientError(
        "edit the note",
        new Error("The target text must not be empty"),
      );
    }

    return updateNote("edit the note", id, (note) => {
      const index = note.body.indexOf(target);
      if (index < 0) {
        throw new NottyClientError(
          "edit the note",
          new Error(`Target text not found in note ${id}`),
        );
      }
      return cloneNote(note, {
        body:
          note.body.slice(0, index) +
          replacementText +
          note.body.slice(index + target.length),
        modified: now().toISOString(),
      });
    });
  };

  const replaceNoteBody = (id: string, body: string): Promise<NottyNote> =>
    updateNote("replace the note body", id, (note) =>
      cloneNote(note, { body, modified: now().toISOString() }),
    );

  const renameNote = (
    id: string,
    title: string,
    renameOptions: RenameNoteOptions = {},
  ): Promise<NottyNote> =>
    updateNote("rename the note", id, (note) =>
      cloneNote(note, {
        title,
        titleLocked: renameOptions.lock !== false,
        modified: now().toISOString(),
      }),
    );

  const moveNote = (id: string, folder: string): Promise<NottyNote> =>
    run("move the note", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        const found = yield* index.get(id);
        if (found === null) {
          throw new Error(`Note not found: ${id}`);
        }
        return yield* index.save(found.note, folder);
      }));

  const pinNote = (id: string, pinned = true): Promise<NottyNote> =>
    updateNote("pin the note", id, (note) =>
      cloneNote(note, { pinned }),
    );

  const archiveNote = (id: string, archived = true): Promise<NottyNote> =>
    updateNote("archive the note", id, (note) =>
      cloneNote(note, { archived }),
    );

  const duplicateNote = async (id: string): Promise<NottyNote> => {
    const found = await requireNote("duplicate the note", id);
    const createdAt = now().toISOString();
    return saveNote(
      {
        id: newId(),
        title: found.note.title,
        created: createdAt,
        modified: createdAt,
        pinned: false,
        archived: false,
        ...(found.note.titleLocked === true ? { titleLocked: true } : {}),
        body: found.note.body,
        ...(found.note.extra === undefined
          ? {}
          : { extra: found.note.extra }),
      },
      found.folder,
    );
  };

  const trashNote = (id: string): Promise<void> =>
    run("trash the note", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        yield* index.trash(id);
      }));

  const restoreNote = async (id: string): Promise<NottyNote> => {
    const restored: IndexedNote | null = await run("restore the note", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* index.restore(id);
      }));
    if (restored === null) {
      throw new NottyClientError(
        "restore the note",
        new Error(`Note not found in Trash: ${id}`),
      );
    }
    return restored;
  };

  const listTrashNotes = (): Promise<ReadonlyArray<NoteSummary>> =>
    run("list the Trash", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return yield* index.listTrash();
      }));

  const purgeNote = (id: string): Promise<void> =>
    run("delete the note permanently", () =>
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        yield* index.purge(id);
      }));

  const listFolders = (): Promise<ReadonlyArray<string>> =>
    run("list the folders", () =>
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.listFolders();
      }));

  const createFolder = (folder: string): Promise<string> =>
    run("create the folder", () =>
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.createFolder(folder);
      }));

  const renameFolder = (
    folder: string,
    nextFolder: string,
  ): Promise<string> =>
    run("rename the folder", () =>
      Effect.gen(function* () {
        const vault = yield* Vault;
        const index = yield* NoteIndex;
        const renamed = yield* vault.renameFolder(folder, nextFolder);
        // Folder membership is the file's directory. Rebuild so every index
        // row points at the file's new location.
        yield* index.rebuild();
        return renamed;
      }));

  const deleteFolder = (folder: string): Promise<void> =>
    run("delete the folder", () =>
      Effect.gen(function* () {
        const vault = yield* Vault;
        const index = yield* NoteIndex;
        yield* vault.deleteFolder(folder);
        yield* index.rebuild();
      }));

  const dispose = async (): Promise<void> => {
    await runtime.dispose();
    if (options.cleanup !== undefined) await options.cleanup();
  };

  return {
    listNotes,
    searchNotes,
    readNote,
    createNote,
    appendToNote,
    editNote,
    replaceNoteBody,
    renameNote,
    moveNote,
    pinNote,
    archiveNote,
    duplicateNote,
    trashNote,
    restoreNote,
    listTrashNotes,
    purgeNote,
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    dispose,
    list: listNotes,
    search: searchNotes,
    get: readNote,
    setPinned: pinNote,
    setArchived: archiveNote,
  };
};

const limitNotes = (
  notes: ReadonlyArray<NoteSummary>,
  limit: number | undefined,
): ReadonlyArray<NoteSummary> =>
  limit === undefined || limit < 0 ? notes : notes.slice(0, Math.trunc(limit));

/** Production adapter: the XDG vault and its `notty.db` index file. */
export const createProductionNottyClient = (
  options: Omit<NottyClientOptions, "root" | "paths"> & {
    readonly root?: string;
    readonly paths?: VaultPaths;
  } = {},
): Promise<NottyClient> => createNottyClient(options);

/** Test adapter: a temporary directory and an in-memory SQLite index. */
export const createMemoryNottyClient = async (
  options: Omit<NottyClientOptions, "database"> & {
    readonly database?: string | null;
  } = {},
): Promise<NottyClient> => {
  let root = options.root;
  let cleanup = options.cleanup;

  if (root === undefined) {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    root = await mkdtemp(join(tmpdir(), "notty-client-"));
    const created = root;
    cleanup = async () => {
      await rm(created, { recursive: true, force: true });
    };
  }

  return createNottyClient({
    ...options,
    root,
    database: ":memory:",
    ...(cleanup === undefined ? {} : { cleanup }),
  });
};
