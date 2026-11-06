/**
 * Private: the SQL schema and statements.
 *
 * Every query in the module lives here, so the two drivers (`node:sqlite` in
 * tests, `plugin-sql` in the app) run byte-identical SQL.
 */
import type { IndexedNote, NoteSummary } from "./service";

export const SCHEMA_VERSION = 3;

/**
 * Connection settings applied before the index is read.
 *
 * WAL lets the desktop app and the CLI read and write the same database
 * without blocking each other; the busy timeout turns a short write overlap
 * into a wait instead of an immediate SQLITE_BUSY failure.
 */
export const CONNECTION_PRAGMAS: ReadonlyArray<string> = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
];

export const CREATE_SCHEMA: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    created TEXT NOT NULL,
    modified TEXT NOT NULL,
    pinned INTEGER NOT NULL,
    archived INTEGER NOT NULL,
    title_locked INTEGER NOT NULL,
    folder TEXT NOT NULL,
    path TEXT NOT NULL,
    body TEXT NOT NULL,
    source_mtime INTEGER NOT NULL,
    source_size INTEGER NOT NULL
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_vocab USING fts5vocab(notes_fts, 'row')`,
  `PRAGMA user_version = ${SCHEMA_VERSION}`,
];

export const DROP_SCHEMA: ReadonlyArray<string> = [
  "DROP TABLE IF EXISTS notes_vocab",
  "DROP TABLE IF EXISTS notes_fts",
  "DROP TABLE IF EXISTS notes",
];

export const DELETE_ALL_NOTES = "DELETE FROM notes";
export const DELETE_ALL_FTS = "DELETE FROM notes_fts";
export const DELETE_NOTE = "DELETE FROM notes WHERE id = ?";

const SUMMARY_COLUMNS =
  "notes.id, notes.title, notes.created, notes.modified, notes.pinned, notes.archived, notes.folder";

export const LIST_NOTES = (where: ReadonlyArray<string>): string =>
  `SELECT ${SUMMARY_COLUMNS} FROM notes${
    where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY notes.pinned DESC, notes.modified DESC, notes.id ASC`;

export const GET_NOTE = `SELECT notes.* FROM notes WHERE notes.id = ?`;

export const GET_NOTE_PATH = "SELECT path FROM notes WHERE id = ?";

export const UPSERT_NOTE = `INSERT INTO notes (
  id, title, created, modified, pinned, archived, title_locked, folder, path, body,
  source_mtime, source_size
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  created = excluded.created,
  modified = excluded.modified,
  pinned = excluded.pinned,
  archived = excluded.archived,
  title_locked = excluded.title_locked,
  folder = excluded.folder,
  path = excluded.path,
  body = excluded.body,
  source_mtime = excluded.source_mtime,
  source_size = excluded.source_size`;

export const DELETE_FTS = "DELETE FROM notes_fts WHERE id = ?";

export const INSERT_FTS =
  "INSERT INTO notes_fts (id, title, body) VALUES (?, ?, ?)";

/** Title matches count five times as much as body matches. */
export const SEARCH_NOTES = `SELECT ${SUMMARY_COLUMNS} FROM notes_fts
JOIN notes ON notes.id = notes_fts.id
WHERE notes_fts MATCH ?
ORDER BY bm25(notes_fts, 0.0, 5.0, 1.0), notes.modified DESC, notes.id ASC
LIMIT ?`;

export const SELECT_FINGERPRINTS =
  "SELECT path, source_mtime, source_size FROM notes";

/**
 * The index's vocabulary, used to widen a search to near-miss spellings. Only
 * terms of a plausible length are read; edit distance decides the rest.
 */
export const SEARCH_VOCABULARY =
  "SELECT term, doc FROM notes_vocab WHERE length(term) BETWEEN ? AND ?";

export const INTEGRITY_CHECK = "PRAGMA quick_check";
export const SCHEMA_VERSION_QUERY = "PRAGMA user_version";
export const TABLE_COUNT =
  "SELECT count(*) AS total FROM sqlite_master WHERE name IN ('notes', 'notes_fts', 'notes_vocab')";

export interface NoteRow {
  readonly id: string;
  readonly title: string;
  readonly created: string;
  readonly modified: string;
  readonly pinned: number;
  readonly archived: number;
  readonly title_locked: number;
  readonly folder: string;
  readonly path: string;
  readonly body: string;
  readonly source_mtime: number;
  readonly source_size: number;
}

export interface SummaryRow {
  readonly id: string;
  readonly title: string;
  readonly created: string;
  readonly modified: string;
  readonly pinned: number;
  readonly archived: number;
  readonly folder: string;
}

export interface FingerprintRow {
  readonly path: string;
  readonly source_mtime: number;
  readonly source_size: number;
}

export const toSummary = (row: SummaryRow): NoteSummary => ({
  id: row.id,
  title: row.title,
  created: row.created,
  modified: row.modified,
  pinned: Number(row.pinned) !== 0,
  archived: Number(row.archived) !== 0,
  folder: row.folder,
});

export const toIndexedNote = (row: NoteRow): IndexedNote => ({
  note: {
    id: row.id,
    title: row.title,
    created: row.created,
    modified: row.modified,
    pinned: Number(row.pinned) !== 0,
    archived: Number(row.archived) !== 0,
    ...(Number(row.title_locked) !== 0 ? { titleLocked: true } : {}),
    body: row.body,
  },
  folder: row.folder,
});

export interface VocabularyRow {
  readonly term: string;
  readonly doc: number;
}

const TOKEN = /[\p{L}\p{N}\p{M}_]+/gu;

/** Fold the way FTS5's `unicode61` tokenizer does for Latin text. */
const normalizeToken = (token: string): string =>
  token.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** The searchable words in the user's query, in source order. */
export const searchTokens = (input: string): ReadonlyArray<string> =>
  (input.match(TOKEN) ?? [])
    .map(normalizeToken)
    .filter((token) => token.length > 0);

/**
 * Turn free text into a safe FTS5 phrase query. Quoting means user input can
 * never be parsed as FTS syntax; the trailing `*` prefix-matches the final
 * token so search-as-you-type finds partial words.
 */
export const ftsQuery = (input: string): string | null => {
  const tokens = searchTokens(input);
  if (tokens.length === 0) return null;
  return `"${tokens.join(" ")}"*`;
};

const quote = (token: string): string => `"${token.replace(/"/g, '""')}"`;

/**
 * An FTS5 query that accepts any of the supplied alternatives for each word.
 * Every word must still match, so widening a typo never drops the rest of the
 * query.
 */
export const fuzzyFtsQuery = (
  tokens: ReadonlyArray<string>,
  alternatives: ReadonlyArray<ReadonlyArray<string>>,
): string | null => {
  if (tokens.length === 0) return null;

  const groups = tokens.map((token, index) => {
    const unique = Array.from(new Set([token, ...(alternatives[index] ?? [])]));
    return unique.length === 1
      ? quote(token)
      : `(${unique.map(quote).join(" OR ")})`;
  });
  return groups.join(" AND ");
};

/**
 * True when `left` is within `max` edits of `right`, using optimal string
 * alignment so a swapped pair counts as one edit.
 */
export const withinEditDistance = (
  left: string,
  right: string,
  max: number,
): boolean => {
  if (left === right) return true;
  if (max < 0 || Math.abs(left.length - right.length) > max) return false;
  if (left.length === 0) return right.length <= max;
  if (right.length === 0) return left.length <= max;

  let beforePrevious: number[] = new Array(right.length + 1).fill(0);
  let previous: number[] = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let row = 1; row <= left.length; row += 1) {
    const current: number[] = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitution,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, beforePrevious[column - 2] + 1);
      }
      current[column] = value;
      if (value < rowMinimum) rowMinimum = value;
    }
    if (rowMinimum > max) return false;
    beforePrevious = previous;
    previous = current;
  }

  return previous[right.length] <= max;
};
