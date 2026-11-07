/**
 * Private: the adapter-independent note-index behaviour.
 *
 * Everything that matters — startup recovery, save ordering, rebuild walking,
 * search — is written once here over two seams: a SQL driver and note-file
 * storage. The runtime adapters differ only in those two seams, so the file
 * format and the index contract cannot drift between tests and the app.
 */
import { Effect } from "effect";
import {
  ATTACHMENTS_DIRECTORY,
  deriveAutoTitle,
  parse,
  serialize,
  type Note,
} from "../note-file";
import type { SqlDriver, SqlStatement, SqlValue } from "./driver";
import {
  NoteIndexError,
  type FileSyncResult,
  type IndexedNote,
  type ListOptions,
  type NoteIndexShape,
  type NoteSummary,
} from "./service";
import {
  CONNECTION_PRAGMAS,
  CREATE_SCHEMA,
  DELETE_ALL_FTS,
  DELETE_ALL_NOTES,
  DELETE_FTS,
  DELETE_NOTE,
  DROP_SCHEMA,
  GET_FINGERPRINT_BY_PATH,
  GET_NOTE,
  GET_NOTE_ID_BY_PATH,
  GET_NOTE_PATH,
  INSERT_FTS,
  INTEGRITY_CHECK,
  LIST_NOTES,
  SCHEMA_VERSION,
  SCHEMA_VERSION_QUERY,
  SEARCH_NOTES,
  SEARCH_VOCABULARY,
  SELECT_FINGERPRINTS,
  TABLE_COUNT,
  UPSERT_NOTE,
  WAL_PRAGMA,
  ftsQuery,
  fuzzyFtsQuery,
  searchTokens,
  toIndexedNote,
  toSummary,
  withinEditDistance,
  type FingerprintRow,
  type NoteRow,
  type SummaryRow,
  type VocabularyRow,
} from "./sql";
import type { NoteStorage, NoteStorageStat } from "./storage";

const MARKDOWN_SUFFIX = ".md";
const TRASH_DIRECTORY = ".trash";
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_FUZZY_ALTERNATIVES = 64;

export interface OpenNoteIndexOptions {
  /** Absolute vault root. Note files live beneath it. */
  readonly root: string;
  /** Absolute index path, or `null` for an in-memory database. */
  readonly databasePath: string | null;
  readonly openDriver: () => Promise<SqlDriver>;
  readonly storage: NoteStorage;
}

export interface OpenedNoteIndex {
  readonly index: NoteIndexShape;
  readonly close: () => Promise<void>;
}

interface WalkedNote {
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
}

/**
 * Open the index and make it agree with the vault.
 *
 * Startup is acquisition: a healthy, schema-matching, fingerprint-matching
 * index opens as-is; anything else is treated as corrupt, rebuilt from the
 * note files, and only then handed to callers.
 */
export const openNoteIndex = async (
  options: OpenNoteIndexOptions,
): Promise<OpenedNoteIndex> => {
  const root = stripTrailingSlash(options.root);
  let driver: SqlDriver | null = null;
  let current = false;

  const openDriver = async (): Promise<SqlDriver> => {
    const opened = await options.openDriver();
    await applyConnectionPragmas(opened);
    return opened;
  };

  try {
    driver = await openDriver();
  } catch {
    // The file cannot be opened at all; recreate it below.
  }

  if (driver !== null) {
    try {
      current =
        (await isIntact(driver)) &&
        (await isHealthy(driver)) &&
        (await isCurrent(driver, root, options.storage));
    } catch {
      current = false;
    }

    if (!current) {
      try {
        // A missing or stale schema is rebuilt in place. Keeping the open
        // connection means a concurrently starting app is not left holding a
        // deleted file. A new database is intact but empty, so simultaneous
        // first runs all create the schema instead of deleting each other's.
        await resetSchema(driver);
      } catch {
        // The database survived opening but cannot hold a schema, so it is
        // corrupt. Recreate it below.
        await driver.close().catch(() => undefined);
        driver = null;
      }
    }
  }

  if (driver === null) {
    if (options.databasePath !== null) {
      await options.storage.remove(options.databasePath).catch(() => undefined);
    }
    driver = await openDriver();
    await resetSchema(driver);
  }

  if (!current) {
    await replaceAll(driver, root, options.storage);
  }

  return {
    index: makeNoteIndex(driver, root, options.storage),
    close: () => driver.close(),
  };
};

const applyConnectionPragmas = async (driver: SqlDriver): Promise<void> => {
  for (const sql of CONNECTION_PRAGMAS) {
    try {
      await driver.execute({ sql });
    } catch (cause) {
      // Switching to WAL needs a brief exclusive lock. When another process
      // is opening at the same moment, keep the connection: the busy timeout
      // serialises writes, and a later open can switch the journal mode.
      if (sql !== WAL_PRAGMA) throw cause;
    }
  }
};

export const makeNoteIndex = (
  driver: SqlDriver,
  root: string,
  storage: NoteStorage,
): NoteIndexShape => {
  const attempt = <A>(
    operation: string,
    path: string | undefined,
    run: () => Promise<A>,
  ): Effect.Effect<A, NoteIndexError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        cause instanceof NoteIndexError
          ? cause
          : new NoteIndexError({ operation, path, cause }),
    });

  const list = (
    options: ListOptions = {},
  ): Effect.Effect<ReadonlyArray<NoteSummary>, NoteIndexError> =>
    attempt("list", undefined, async () => {
      const where: string[] = [];
      const params: SqlValue[] = [];

      if (options.archived !== undefined) {
        where.push("notes.archived = ?");
        params.push(options.archived ? 1 : 0);
      } else if (options.includeArchived !== true) {
        where.push("notes.archived = 0");
      }
      if (options.pinned !== undefined) {
        where.push("notes.pinned = ?");
        params.push(options.pinned ? 1 : 0);
      }
      if (options.folder !== undefined) {
        where.push("notes.folder = ?");
        params.push(normalizeFolder(options.folder));
      }

      const rows = await driver.select<SummaryRow>({
        sql: LIST_NOTES(where),
        params,
      });
      return rows.map(toSummary);
    });

  const get = (id: string): Effect.Effect<IndexedNote | null, NoteIndexError> =>
    attempt("get", undefined, async () => {
      const rows = await driver.select<NoteRow>({
        sql: GET_NOTE,
        params: [id],
      });
      const row = rows[0];
      return row === undefined ? null : toIndexedNote(row);
    });

  const save = (
    note: Note,
    folder: string,
  ): Effect.Effect<IndexedNote, NoteIndexError> =>
    attempt("save", undefined, async () => {
      if (note.id.length === 0) {
        throw new Error("A note must have an id before it can be saved");
      }
      const targetFolder = normalizeFolder(folder);

      const existing = await driver.select<{ path: string }>({
        sql: GET_NOTE_PATH,
        params: [note.id],
      });
      const basename =
        existing[0] === undefined ? `${note.id}${MARKDOWN_SUFFIX}` : basenameOf(existing[0].path);
      const path = joinRelative(targetFolder, basename);

      // File first, index second. A failure here leaves the file on disk and
      // the index behind, which startup rebuild repairs.
      if (targetFolder.length > 0) {
        await storage.makeDirectory(absolutePath(root, targetFolder));
      }
      await storage.writeTextFile(absolutePath(root, path), serialize(note));

      const previousPath = existing[0]?.path;
      if (previousPath !== undefined && previousPath !== path) {
        await storage.remove(absolutePath(root, previousPath));
      }

      const info = await storage.stat(absolutePath(root, path));
      if (info === null) {
        throw new Error(`Note file disappeared after writing: ${path}`);
      }

      await driver.transaction(noteStatements(note, targetFolder, path, info));
      return { note, folder: targetFolder };
    });

  const trash = (id: string): Effect.Effect<void, NoteIndexError> =>
    attempt("trash", undefined, async () => {
      const rows = await driver.select<{ path: string }>({
        sql: GET_NOTE_PATH,
        params: [id],
      });
      const existing = rows[0];
      if (existing === undefined) {
        throw new Error(`Note not found: ${id}`);
      }

      const target = await availableTrashPath(root, existing.path, id, storage);
      await storage.makeDirectory(
        parentDirectory(absolutePath(root, target)),
      );
      await storage.rename(
        absolutePath(root, existing.path),
        absolutePath(root, target),
      );

      // The file is already safe in `.trash`; a failed transaction leaves a
      // stale row that startup recovery drops.
      await driver.transaction([
        { sql: DELETE_NOTE, params: [id] },
        { sql: DELETE_FTS, params: [id] },
      ]);
    });

  const restore = (
    id: string,
  ): Effect.Effect<IndexedNote | null, NoteIndexError> =>
    attempt("restore", undefined, async () => {
      const found = await findTrashedNote(root, storage, id);
      if (found === null) return null;

      const folder = folderOf(found.relativePath);
      const target = await availableRestorePath(
        root,
        found.relativePath,
        id,
        storage,
      );
      await storage.makeDirectory(
        parentDirectory(absolutePath(root, target)),
      );
      await storage.rename(
        absolutePath(root, joinRelative(TRASH_DIRECTORY, found.relativePath)),
        absolutePath(root, target),
      );

      const info = await storage.stat(absolutePath(root, target));
      if (info === null) {
        throw new Error(`Restored note file disappeared: ${target}`);
      }
      await driver.transaction(noteStatements(found.note, folder, target, info));
      return { note: found.note, folder };
    });

  const listTrash = (): Effect.Effect<
    ReadonlyArray<NoteSummary>,
    NoteIndexError
  > =>
    attempt("listTrash", undefined, async () => {
      const trashRoot = absolutePath(root, TRASH_DIRECTORY);
      if ((await storage.stat(trashRoot)) === null) return [];
      const files = await collectNotes(trashRoot, storage);
      const notes: NoteSummary[] = [];

      for (const file of files) {
        const note = await readNote(
          storage,
          absolutePath(trashRoot, file.path),
          file.path,
        );
        if (note === null) continue;
        notes.push({
          id: note.id,
          title: note.title,
          created: note.created,
          modified: note.modified,
          pinned: note.pinned,
          archived: note.archived,
          folder: folderOf(file.path),
        });
      }

      return notes.sort((left, right) =>
        left.modified !== right.modified
          ? left.modified < right.modified
            ? 1
            : -1
          : left.id.localeCompare(right.id),
      );
    });

  const purge = (id: string): Effect.Effect<void, NoteIndexError> =>
    attempt("purge", undefined, async () => {
      const found = await findTrashedNote(root, storage, id);
      if (found === null) {
        throw new Error(`Note not found in Trash: ${id}`);
      }
      await storage.remove(
        absolutePath(root, joinRelative(TRASH_DIRECTORY, found.relativePath)),
      );
    });

  const search = (
    query: string,
    limit: number = DEFAULT_SEARCH_LIMIT,
  ): Effect.Effect<ReadonlyArray<NoteSummary>, NoteIndexError> =>
    attempt("search", undefined, async () => {
      const match = ftsQuery(query);
      if (match === null) return [];
      const size =
        Number.isFinite(limit) && limit > 0
          ? Math.trunc(limit)
          : DEFAULT_SEARCH_LIMIT;
      const exact = await driver.select<SummaryRow>({
        sql: SEARCH_NOTES,
        params: [match, size],
      });
      if (exact.length >= size) return exact.map(toSummary);

      // Only pay for the vocabulary scan when the literal query did not fill
      // the result list. Exact matches always stay ahead of fuzzy ones.
      const tokens = searchTokens(query);
      const alternatives = await fuzzyAlternatives(driver, tokens);
      if (!alternatives.some((terms) => terms.length > 0)) {
        return exact.map(toSummary);
      }
      const widened = fuzzyFtsQuery(tokens, alternatives);
      if (widened === null) return exact.map(toSummary);

      const fuzzy = await driver.select<SummaryRow>({
        sql: SEARCH_NOTES,
        params: [widened, size],
      });
      const seen = new Set(exact.map((row) => row.id));
      const merged = [...exact];
      for (const row of fuzzy) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push(row);
        if (merged.length >= size) break;
      }
      return merged.map(toSummary);
    });

  const syncFile = (
    relativePath: string,
  ): Effect.Effect<FileSyncResult, NoteIndexError> =>
    attempt("syncFile", relativePath, async () => {
      const path = normalizeRelativePath(relativePath);
      if (!isIndexableRelativePath(path)) {
        return { status: "ignored" } as const;
      }

      const absolute = absolutePath(root, path);
      const existing = (
        await driver.select<{ id: string }>({
          sql: GET_NOTE_ID_BY_PATH,
          params: [path],
        })
      )[0];

      const info = await storage.stat(absolute);
      if (info === null) {
        if (existing === undefined) {
          // The CLI removed the file and its row before the watcher fired.
          // The id is unknown, but the caller still needs to know a note file
          // disappeared so it can reconcile its own list.
          return { status: "removed", id: null, path } as const;
        }
        await driver.transaction([
          { sql: DELETE_NOTE, params: [existing.id] },
          { sql: DELETE_FTS, params: [existing.id] },
        ]);
        return { status: "removed", id: existing.id, path } as const;
      }

      if (existing !== undefined) {
        const fingerprint = (
          await driver.select<FingerprintRow>({
            sql: GET_FINGERPRINT_BY_PATH,
            params: [path],
          })
        )[0];
        // Notty's own auto-save wrote this file: the row already carries the
        // stat of that exact write, so no SQL is needed. The note still goes
        // back to the caller: another process (the CLI) may have written both
        // the file and the row, and the caller's in-memory list can be stale
        // or missing the note entirely.
        if (
          fingerprint !== undefined &&
          Number(fingerprint.source_mtime) === Math.trunc(info.mtime) &&
          Number(fingerprint.source_size) === info.size
        ) {
          const rows = await driver.select<NoteRow>({
            sql: GET_NOTE,
            params: [existing.id],
          });
          const row = rows[0];
          if (row !== undefined) {
            return {
              status: "unchanged",
              note: toIndexedNote(row),
              path,
            } as const;
          }
        }
      }

      const note = noteFromContents(
        await storage.readTextFile(absolute),
        path,
        info,
      );
      const folder = folderOf(path);
      const statements: SqlStatement[] = [];
      if (existing !== undefined && existing.id !== note.id) {
        // The file's identity changed under the same path (rare, but an
        // external tool may rewrite frontmatter). Drop the old row first so
        // listing cannot show both notes.
        statements.push(
          { sql: DELETE_NOTE, params: [existing.id] },
          { sql: DELETE_FTS, params: [existing.id] },
        );
      }
      statements.push(...noteStatements(note, folder, path, info));
      await driver.transaction(statements);

      return {
        status: "upserted",
        note: { note, folder },
        path,
      } as const;
    });

  const rebuild = (): Effect.Effect<void, NoteIndexError> =>
    attempt("rebuild", undefined, async () => {
      await resetSchema(driver);
      await replaceAll(driver, root, storage);
    });

  return {
    list,
    get,
    save,
    syncFile,
    search,
    trash,
    restore,
    listTrash,
    purge,
    rebuild,
  };
};

/**
 * Widen each token to near-miss terms already in the index. Short tokens are
 * left alone: a one-edit radius around a three-letter word matches too much to
 * be useful, and the prefix query already covers typing-in-progress.
 */
const fuzzyAlternatives = async (
  driver: SqlDriver,
  tokens: ReadonlyArray<string>,
): Promise<ReadonlyArray<ReadonlyArray<string>>> => {
  const alternatives: string[][] = [];

  for (const token of tokens) {
    if (token.length < 4) {
      alternatives.push([]);
      continue;
    }

    const radius = token.length >= 8 ? 2 : 1;
    const rows = await driver.select<VocabularyRow>({
      sql: SEARCH_VOCABULARY,
      params: [token.length - radius, token.length + radius],
    });
    const matches = rows
      .filter(
        (row) =>
          row.term !== token &&
          withinEditDistance(token, row.term, radius),
      )
      .sort(
        (left, right) =>
          Number(right.doc) - Number(left.doc) ||
          left.term.localeCompare(right.term),
      )
      .slice(0, MAX_FUZZY_ALTERNATIVES)
      .map((row) => row.term);
    alternatives.push(matches);
  }

  return alternatives;
};

const resetSchema = async (driver: SqlDriver): Promise<void> => {
  const statements: SqlStatement[] = [
    ...DROP_SCHEMA.map((sql) => ({ sql })),
    ...CREATE_SCHEMA.map((sql) => ({ sql })),
  ];
  await driver.transaction(statements);
};

/** True when SQLite itself reports the database as sound. */
const isIntact = async (driver: SqlDriver): Promise<boolean> => {
  const integrity = await driver.select<Record<string, unknown>>({
    sql: INTEGRITY_CHECK,
  });
  const verdict = integrity[0] === undefined ? undefined : Object.values(integrity[0])[0];
  return verdict === "ok";
};

/** True when the schema is present at the current version. */
const isHealthy = async (driver: SqlDriver): Promise<boolean> => {
  const version = await driver.select<{ user_version: number }>({
    sql: SCHEMA_VERSION_QUERY,
  });
  if (Number(version[0]?.user_version) !== SCHEMA_VERSION) return false;

  const tables = await driver.select<{ total: number }>({ sql: TABLE_COUNT });
  return Number(tables[0]?.total) === 3;
};

/**
 * True when every indexed note still matches the file on disk and every
 * indexable file is present in the index. Cheap checks use the stat
 * fingerprint; only files the index has never seen are parsed.
 */
const isCurrent = async (
  driver: SqlDriver,
  root: string,
  storage: NoteStorage,
): Promise<boolean> => {
  const files = await collectNotes(root, storage);
  const rows = await driver.select<FingerprintRow>({
    sql: SELECT_FINGERPRINTS,
  });

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const row of rows) {
    if (!filesByPath.has(row.path)) return false;
  }

  const rowsByPath = new Map(rows.map((row) => [row.path, row]));
  for (const file of files) {
    const row = rowsByPath.get(file.path);
    if (row !== undefined) {
      if (
        Number(row.source_mtime) !== file.mtime ||
        Number(row.source_size) !== file.size
      ) {
        return false;
      }
      continue;
    }

    // A Markdown file the index has never seen. Stray, unindexable files are
    // ignored; a real note means the index is stale.
    const note = await readNote(
      storage,
      absolutePath(root, file.path),
      file.path,
    );
    if (note !== null) return false;
  }

  return true;
};

const replaceAll = async (
  driver: SqlDriver,
  root: string,
  storage: NoteStorage,
): Promise<void> => {
  const files = await collectNotes(root, storage);
  const statements: SqlStatement[] = [
    { sql: DELETE_ALL_NOTES },
    { sql: DELETE_ALL_FTS },
  ];

  for (const file of files) {
    const note = await readNote(
      storage,
      absolutePath(root, file.path),
      file.path,
    );
    if (note === null) continue;
    statements.push(
      ...noteStatements(note, folderOf(file.path), file.path, file),
    );
  }

  await driver.transaction(statements);
};

const noteStatements = (
  note: Note,
  folder: string,
  path: string,
  info: NoteStorageStat,
): SqlStatement[] => [
  {
    sql: UPSERT_NOTE,
    params: [
      note.id,
      note.title,
      note.created,
      note.modified,
      note.pinned ? 1 : 0,
      note.archived ? 1 : 0,
      note.titleLocked === true ? 1 : 0,
      folder,
      path,
      note.body,
      Math.trunc(info.mtime),
      info.size,
    ],
  },
  { sql: DELETE_FTS, params: [note.id] },
  { sql: INSERT_FTS, params: [note.id, note.title, note.body] },
];

const collectNotes = async (
  root: string,
  storage: NoteStorage,
): Promise<ReadonlyArray<WalkedNote>> => {
  const notes: WalkedNote[] = [];

  const walk = async (folder: string): Promise<void> => {
    const entries = [...(await storage.readDirectory(absolutePath(root, folder)))];
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (entry.name.startsWith(".")) continue;
        if (folder.length === 0 && entry.name === ATTACHMENTS_DIRECTORY) {
          continue;
        }
        await walk(joinRelative(folder, entry.name));
        continue;
      }

      if (!entry.isFile || !entry.name.endsWith(MARKDOWN_SUFFIX)) continue;
      const path = joinRelative(folder, entry.name);
      const info = await storage.stat(absolutePath(root, path));
      if (info === null) continue;
      notes.push({ path, mtime: Math.trunc(info.mtime), size: info.size });
    }
  };

  await walk("");
  notes.sort((left, right) => left.path.localeCompare(right.path));
  return notes;
};

const readNote = async (
  storage: NoteStorage,
  path: string,
  relativePath: string,
): Promise<Note | null> => {
  const parsed = parse(await storage.readTextFile(path));
  if (parsed.id.length > 0) return parsed;

  // A Markdown file written by an external tool may have no frontmatter. It
  // is still a note; its identity comes from the path so every rebuild agrees.
  const info = await storage.stat(path);
  if (info === null) return null;
  return externalNote(parsed, relativePath, info);
};

/**
 * Turn file contents into a Note. Files with frontmatter keep it verbatim;
 * stray Markdown gets a deterministic id derived only from its vault path, so
 * an agent can drop `groceries.md` into the vault and it indexes consistently.
 */
const noteFromContents = (
  contents: string,
  relativePath: string,
  info: NoteStorageStat,
): Note => {
  const parsed = parse(contents);
  return parsed.id.length > 0
    ? parsed
    : externalNote(parsed, relativePath, info);
};

const externalNote = (
  parsed: Note,
  relativePath: string,
  info: NoteStorageStat,
): Note => {
  const timestamp = new Date(info.mtime).toISOString();
  return {
    id: externalNoteId(relativePath),
    title: deriveAutoTitle(timestamp, parsed.body, {}),
    created: timestamp,
    modified: timestamp,
    pinned: false,
    archived: false,
    body: parsed.body,
    ...(parsed.extra === undefined ? {} : { extra: parsed.extra }),
  };
};

/** FNV-1a twice, so a path-derived identity is stable and collision-resistant. */
const externalNoteId = (relativePath: string): string => {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < relativePath.length; index += 1) {
    const code = relativePath.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  const hex = (value: number): string =>
    (value >>> 0).toString(16).padStart(8, "0");
  return `md-${hex(first)}${hex(second)}`;
};

const normalizeRelativePath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");

const isIndexableRelativePath = (path: string): boolean => {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return false;
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) {
    return false;
  }
  if (segments[0] === ATTACHMENTS_DIRECTORY) return false;
  const basename = segments[segments.length - 1] ?? "";
  if (basename.startsWith("notty.db")) return false;
  return basename.toLowerCase().endsWith(MARKDOWN_SUFFIX);
};

const stripTrailingSlash = (path: string): string => path.replace(/\/+$/, "");

const absolutePath = (root: string, relativePath: string): string =>
  relativePath.length === 0 ? root : `${root}/${relativePath}`;

const joinRelative = (...segments: ReadonlyArray<string>): string =>
  segments.filter((segment) => segment.length > 0).join("/");

const folderOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

const basenameOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
};

const parentDirectory = (path: string): string => {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return path;
  if (slash === 0) return "/";
  return path.slice(0, slash);
};

interface TrashedNote {
  readonly note: Note;
  readonly relativePath: string;
}

/**
 * The Trash mirrors the vault tree, so a note's path below `.trash` is its
 * original vault-relative path and restore needs no separate metadata.
 */
const findTrashedNote = async (
  root: string,
  storage: NoteStorage,
  id: string,
): Promise<TrashedNote | null> => {
  const trashRoot = absolutePath(root, TRASH_DIRECTORY);
  if ((await storage.stat(trashRoot)) === null) return null;
  const files = await collectNotes(trashRoot, storage);

  for (const file of files) {
    const note = await readNote(
      storage,
      absolutePath(trashRoot, file.path),
      file.path,
    );
    if (note !== null && note.id === id) {
      return { note, relativePath: file.path };
    }
  }
  return null;
};

const availableTrashPath = async (
  root: string,
  path: string,
  id: string,
  storage: NoteStorage,
): Promise<string> => {
  const mirror = joinRelative(TRASH_DIRECTORY, path);
  if ((await storage.stat(absolutePath(root, mirror))) === null) return mirror;
  return availableFallbackPath(
    root,
    joinRelative(TRASH_DIRECTORY, folderOf(path)),
    id,
    storage,
  );
};

const availableRestorePath = async (
  root: string,
  path: string,
  id: string,
  storage: NoteStorage,
): Promise<string> => {
  if ((await storage.stat(absolutePath(root, path))) === null) return path;
  return availableFallbackPath(root, folderOf(path), id, storage);
};

const availableFallbackPath = async (
  root: string,
  folder: string,
  id: string,
  storage: NoteStorage,
): Promise<string> => {
  const stem = safeFileStem(id);
  for (let suffix = 0; ; suffix += 1) {
    const name = suffix === 0 ? `${stem}${MARKDOWN_SUFFIX}` : `${stem}-${suffix}${MARKDOWN_SUFFIX}`;
    const candidate = joinRelative(folder, name);
    if ((await storage.stat(absolutePath(root, candidate))) === null) {
      return candidate;
    }
  }
};

const safeFileStem = (id: string): string => {
  const stem = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "");
  return stem.length === 0 ? "note" : stem;
};

/**
 * Folders are vault-relative POSIX paths. Absolute paths and `..` escapes are
 * rejected; `""` is the vault root.
 */
const normalizeFolder = (folder: string): string => {
  const trimmed = folder.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith("/") || trimmed.includes("\\")) {
    throw new Error(`Folder must be a vault-relative POSIX path: ${folder}`);
  }
  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new Error(`Folder must stay inside the vault: ${folder}`);
  }
  return segments.join("/");
};
