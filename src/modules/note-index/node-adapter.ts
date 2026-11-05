/**
 * Adapter for Node runtimes: vitest today, CLI tooling later.
 *
 * The SQL driver is `node:sqlite`; the in-memory adapter is the same driver
 * against `:memory:`, so both exercise identical SQL. Tests point the root at
 * a `mkdtemp` directory and never touch the home directory.
 */
import { Effect, Layer } from "effect";
import type { SqlDriver, SqlStatement } from "./driver";
import { openNoteIndex } from "./note-index";
import { NoteIndex, NoteIndexError } from "./service";
import type { NoteStorage } from "./storage";

export interface NoteIndexNodeOptions {
  /** Absolute vault root. */
  readonly root: string;
  /**
   * Absolute SQLite file path, or `:memory:`. Defaults to
   * `<root>/notty.db`.
   */
  readonly database?: string;
}

/**
 * Node builtins are imported lazily: this file is re-exported from the
 * module's interface, which the WebView bundle also imports. Nothing here
 * executes in that bundle, and no `node:` specifier is resolved at its load
 * time.
 */
const nodeStorage: NoteStorage = {
  readTextFile: async (path) => {
    const { readFile } = await import("node:fs/promises");
    return readFile(path, "utf8");
  },
  writeTextFile: async (path, contents) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, contents, "utf8");
  },
  makeDirectory: async (path) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path, { recursive: true });
  },
  readDirectory: async (path) => {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  },
  stat: async (path) => {
    const { stat } = await import("node:fs/promises");
    try {
      const info = await stat(path);
      return { mtime: Math.trunc(info.mtimeMs), size: info.size };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  },
  remove: async (path) => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  },
};

const openNodeDriver = async (database: string): Promise<SqlDriver> => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);

  const execute = (statement: SqlStatement): void => {
    db.prepare(statement.sql).run(...(statement.params ?? []));
  };

  return {
    execute: async (statement) => execute(statement),
    select: async <A>(statement: SqlStatement): Promise<ReadonlyArray<A>> =>
      db.prepare(statement.sql).all(...(statement.params ?? [])) as A[],
    transaction: async (statements) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of statements) execute(statement);
        db.exec("COMMIT");
      } catch (cause) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The transaction is already gone; report the original failure.
        }
        throw cause;
      }
    },
    close: async () => {
      db.close();
    },
  };
};

export const noteIndexNodeLayer = (
  options: NoteIndexNodeOptions,
): Layer.Layer<NoteIndex, NoteIndexError> =>
  Layer.effect(
    NoteIndex,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => {
          const database =
            options.database ??
            `${options.root.replace(/\/+$/, "")}/notty.db`;
          return openNoteIndex({
            root: options.root,
            databasePath: database === ":memory:" ? null : database,
            storage: nodeStorage,
            openDriver: () => openNodeDriver(database),
          });
        },
        catch: (cause) => new NoteIndexError({ operation: "open", cause }),
      }),
      (opened) => Effect.promise(() => opened.close()),
    ).pipe(Effect.map((opened) => opened.index)),
  );

/** The in-memory adapter: real SQLite `:memory:` behind the same seam. */
export const noteIndexMemoryLayer = (
  root: string,
): Layer.Layer<NoteIndex, NoteIndexError> =>
  noteIndexNodeLayer({ root, database: ":memory:" });
