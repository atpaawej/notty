/**
 * Private: the SQL schema and statements.
 *
 * Every query in the module lives here, so the two drivers (`node:sqlite` in
 * tests, `plugin-sql` in the app) run byte-identical SQL.
 */
import type { IndexedNote, NoteSummary } from "./service";

export const SCHEMA_VERSION = 2;

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
  `PRAGMA user_version = ${SCHEMA_VERSION}`,
];

export const DROP_SCHEMA: ReadonlyArray<string> = [
  "DROP TABLE IF EXISTS notes_fts",
  "DROP TABLE IF EXISTS notes",
];

export const DELETE_ALL_NOTES = "DELETE FROM notes";
export const DELETE_ALL_FTS = "DELETE FROM notes_fts";

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

export const INTEGRITY_CHECK = "PRAGMA quick_check";
export const SCHEMA_VERSION_QUERY = "PRAGMA user_version";
export const TABLE_COUNT =
  "SELECT count(*) AS total FROM sqlite_master WHERE name IN ('notes', 'notes_fts')";

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

const TOKEN = /[\p{L}\p{N}\p{M}_]+/gu;

/**
 * Turn free text into a safe FTS5 phrase query. Quoting means user input can
 * never be parsed as FTS syntax; the trailing `*` prefix-matches the final
 * token so search-as-you-type finds partial words.
 */
export const ftsQuery = (input: string): string | null => {
  const tokens = input.match(TOKEN);
  if (tokens === null || tokens.length === 0) return null;
  return `"${tokens.join(" ")}"*`;
};
