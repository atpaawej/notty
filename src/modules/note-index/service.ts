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

/**
 * What one incremental file reconcile did. `unchanged` is the echo-suppression
 * path: the file's stat fingerprint still matches the index row, so no SQL and
 * no render are needed.
 */
export type FileSyncResult =
  | { readonly status: "ignored" }
  | { readonly status: "unchanged" }
  | { readonly status: "removed"; readonly id: string; readonly path: string }
  | {
      readonly status: "upserted";
      readonly note: IndexedNote;
      readonly path: string;
    };

export interface ListOptions {
  /** Exact vault-relative folder match. Omit for every folder. */
  readonly folder?: string;
  /** Include archived notes. Defaults to false. */
  readonly includeArchived?: boolean;
  /** Exact archive state. Overrides `includeArchived` when set. */
  readonly archived?: boolean;
  /** Exact pin state. Omit for both. */
  readonly pinned?: boolean;
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
  /**
   * Move a note into the vault's Trash and drop it from the index. The file
   * keeps its original folder path beneath `.trash`, so `restore` can put it
   * back where it came from.
   */
  readonly trash: (id: string) => Effect.Effect<void, NoteIndexError>;
  /** Put a trashed note back, or `null` when the id is not in the Trash. */
  readonly restore: (
    id: string,
  ) => Effect.Effect<IndexedNote | null, NoteIndexError>;
  /** Every note in the Trash, most recently modified first. */
  readonly listTrash: () => Effect.Effect<
    ReadonlyArray<NoteSummary>,
    NoteIndexError
  >;
  /** Permanently delete one trashed note. */
  readonly purge: (id: string) => Effect.Effect<void, NoteIndexError>;
  /**
   * Reconcile one vault-relative Markdown file after an external change:
   * upsert it from a single read, or drop it when it no longer exists. The
   * stat fingerprint suppresses the echo of Notty's own auto-save.
   */
  readonly syncFile: (
    relativePath: string,
  ) => Effect.Effect<FileSyncResult, NoteIndexError>;
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
