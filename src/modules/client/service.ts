/**
 * Private: the NottyClient interface.
 *
 * This is the whole programmatic surface over a vault. Callers and tests cross
 * this seam; they never see Effect, SQL rows or note-file paths.
 */
import type { IndexedNote, NoteSummary } from "../note-index";

/** A note-list filter. Omitted fields mean "no constraint". */
export interface ListNotesOptions {
  /** Exact vault-relative folder; `""` is the vault root. */
  readonly folder?: string;
  /** Exact pin state. */
  readonly pinned?: boolean;
  /** Exact archive state. Defaults to active notes only. */
  readonly archived?: boolean;
  /** Include archived notes when no exact archive state is given. */
  readonly includeArchived?: boolean;
  /** Maximum number of notes to return after filtering. */
  readonly limit?: number;
}

export interface SearchNotesOptions {
  readonly limit?: number;
  /** Include archived notes in results. Defaults to false. */
  readonly includeArchived?: boolean;
  /** Restrict results to one vault-relative folder. */
  readonly folder?: string;
}

export interface CreateNoteInput {
  /** Vault-relative folder; `""` or omitted is the vault root. */
  readonly folder?: string;
  /** An explicit title locks it against auto-title changes. */
  readonly title?: string;
  /** Markdown body. Defaults to empty. */
  readonly body?: string;
}

export interface EditNoteInput {
  /** Exact text to find. The first occurrence is replaced. */
  readonly target: string;
  /** Text to put in its place. */
  readonly replacement: string;
}

export interface RenameNoteOptions {
  /** Keep the new title fixed against auto-title changes. Defaults to true. */
  readonly lock?: boolean;
}

/** A note as a programmatic caller sees it: its value plus its folder. */
export type NottyNote = IndexedNote;

/**
 * The deep interface over Notty's vault, note files and index.
 *
 * Every method resolves with a plain value or rejects with
 * `NottyClientError`; Effect types stay behind this seam.
 */
export interface NottyClient {
  readonly listNotes: (
    options?: ListNotesOptions,
  ) => Promise<ReadonlyArray<NoteSummary>>;
  readonly searchNotes: (
    query: string,
    options?: SearchNotesOptions,
  ) => Promise<ReadonlyArray<NoteSummary>>;
  readonly readNote: (id: string) => Promise<NottyNote | null>;
  readonly createNote: (input?: CreateNoteInput) => Promise<NottyNote>;
  /** Append without replacing existing text; adds one newline when needed. */
  readonly appendToNote: (id: string, text: string) => Promise<NottyNote>;
  /** Replace the first exact occurrence of `target`. */
  readonly editNote: {
    (id: string, edit: EditNoteInput): Promise<NottyNote>;
    (id: string, target: string, replacement: string): Promise<NottyNote>;
  };
  /** Replace the whole Markdown body. */
  readonly replaceNoteBody: (id: string, body: string) => Promise<NottyNote>;
  readonly renameNote: (
    id: string,
    title: string,
    options?: RenameNoteOptions,
  ) => Promise<NottyNote>;
  readonly moveNote: (id: string, folder: string) => Promise<NottyNote>;
  readonly pinNote: (id: string, pinned?: boolean) => Promise<NottyNote>;
  readonly archiveNote: (
    id: string,
    archived?: boolean,
  ) => Promise<NottyNote>;
  readonly duplicateNote: (id: string) => Promise<NottyNote>;
  readonly trashNote: (id: string) => Promise<void>;
  readonly restoreNote: (id: string) => Promise<NottyNote>;
  readonly listFolders: () => Promise<ReadonlyArray<string>>;
  readonly createFolder: (folder: string) => Promise<string>;
  readonly renameFolder: (
    folder: string,
    nextFolder: string,
  ) => Promise<string>;
  readonly deleteFolder: (folder: string) => Promise<void>;
  /** Close the index and release any temporary vault this adapter created. */
  readonly dispose: () => Promise<void>;

  /** Short aliases for callers that prefer the module names. */
  readonly list: NottyClient["listNotes"];
  readonly search: NottyClient["searchNotes"];
  readonly get: NottyClient["readNote"];
  readonly setPinned: NottyClient["pinNote"];
  readonly setArchived: NottyClient["archiveNote"];
}

/** A failed client operation. The original typed error is kept as `cause`. */
export class NottyClientError extends Error {
  readonly operation: string;
  readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(messageOf(operation, cause));
    this.name = "NottyClientError";
    this.operation = operation;
    this.cause = cause;
  }
}

/** The user-facing part of an error, without leaking Effect plumbing. */
export const messageOf = (operation: string, cause: unknown): string => {
  const inner =
    typeof cause === "object" && cause !== null
      ? (cause as { cause?: unknown }).cause ?? cause
      : cause;
  const detail =
    inner instanceof Error
      ? inner.message
      : typeof inner === "string"
        ? inner
        : "";
  return detail.length > 0 ? detail : `Notty could not ${operation}`;
};
