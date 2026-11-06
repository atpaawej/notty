/**
 * Private: the note-file filesystem seam.
 *
 * Paths handed to a storage adapter are absolute. The module reasons in
 * vault-relative POSIX paths everywhere else; only this seam knows about the
 * operating system's filesystem.
 */

export interface NoteStorageEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

export interface NoteStorageStat {
  /** Modification time in milliseconds since the epoch. */
  readonly mtime: number;
  /** Size in bytes. */
  readonly size: number;
}

export interface NoteStorage {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeTextFile: (path: string, contents: string) => Promise<void>;
  readonly makeDirectory: (path: string) => Promise<void>;
  readonly readDirectory: (
    path: string,
  ) => Promise<ReadonlyArray<NoteStorageEntry>>;
  /** `null` when the path does not exist. */
  readonly stat: (path: string) => Promise<NoteStorageStat | null>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
}
