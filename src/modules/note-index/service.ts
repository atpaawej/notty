/**
 * Private: the note-index service definition.
 *
 * Imported by the adapters and re-exported by ./index — never import this file
 * from outside the module. Types here are the whole public surface: callers
 * never see SQL, rows or file paths.
 */
import { Context, Data, type Effect } from "effect";
import type { Note } from "../note-file";

/** A note-list row: everything a list needs and nothing more. */
export interface NoteSummary {
  readonly id: string;
  readonly title: string;
  readonly created: string;
  readonly modified: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  /** Vault-relative POSIX directory; `""` is the vault root. */
  readonly folder: string;
}

/** A note opened from the index: its full note value plus its folder. */
export interface IndexedNote {
  readonly note: Note;
  readonly folder: string;
}

export interface ListOptions {
  /** Exact vault-relative folder match. Omit for every folder. */
  readonly folder?: string;
  /** Include archived notes. Defaults to false. */
  readonly includeArchived?: boolean;
}

export interface NoteIndexShape {
  readonly list: (
    options?: ListOptions,
  ) => Effect.Effect<ReadonlyArray<NoteSummary>, NoteIndexError>;
  readonly get: (id: string) => Effect.Effect<IndexedNote | null, NoteIndexError>;
  readonly save: (
    note: Note,
    folder: string,
  ) => Effect.Effect<IndexedNote, NoteIndexError>;
  readonly search: (
    query: string,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<NoteSummary>, NoteIndexError>;
  readonly rebuild: () => Effect.Effect<void, NoteIndexError>;
}

/**
 * Index operations fail with a typed error and never throw. The `operation`
 * names the interface method that failed; `path` is the entry it touched.
 */
export class NoteIndexError extends Data.TaggedError("NoteIndexError")<{
  readonly operation: string;
  readonly path?: string;
  readonly cause: unknown;
}> {}

export class NoteIndex extends Context.Service<NoteIndex, NoteIndexShape>()(
  "notty/NoteIndex",
) {}
