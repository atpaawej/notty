/**
 * Production adapter for the Tauri WebView.
 *
 * SQL goes through `@tauri-apps/plugin-sql`; note files go through
 * `@tauri-apps/plugin-fs`, scoped to the vault by
 * `src-tauri/capabilities/default.json`. The database lives at
 * `<vault root>/notty.db`.
 *
 * `plugin-sql` exposes no transaction primitive, so the driver serialises all
 * calls through one queue. Sequential calls reuse the pool's single idle
 * SQLite connection, which keeps `BEGIN`/`COMMIT` on the same connection.
 */
import {
  lstat,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";
import { Effect, Layer } from "effect";
import { Vault } from "../vault";
import type { SqlDriver, SqlStatement } from "./driver";
import { openNoteIndex } from "./note-index";
import { NoteIndex, NoteIndexError } from "./service";
import type { NoteStorage } from "./storage";

const tauriStorage: NoteStorage = {
  readTextFile: (path) => readTextFile(path),
  writeTextFile: async (path, contents) => {
    await writeTextFile(path, contents);
  },
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readDirectory: async (path) => {
    const entries = await readDir(path);
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory,
      isFile: entry.isFile,
    }));
  },
  stat: async (path) => {
    try {
      const info = await lstat(path);
      return {
        mtime: Math.trunc(info.mtime?.getTime() ?? 0),
        size: info.size,
      };
    } catch {
      return null;
    }
  },
  remove: (path) => remove(path),
};

const openTauriDriver = async (databasePath: string): Promise<SqlDriver> => {
  const db = await Database.load(`sqlite:${databasePath}`);

  // One operation at a time: this is what makes BEGIN/COMMIT safe in the
  // plugin's connection pool.
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <A>(run: () => Promise<A>): Promise<A> => {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const execute = (statement: SqlStatement): Promise<void> =>
    serialize(async () => {
      await db.execute(statement.sql, [...(statement.params ?? [])]);
    });

  return {
    execute,
    select: <A>(statement: SqlStatement): Promise<ReadonlyArray<A>> =>
      serialize(() =>
        db.select<A[]>(statement.sql, [...(statement.params ?? [])]),
      ),
    transaction: (statements) =>
      serialize(async () => {
        await db.execute("BEGIN IMMEDIATE");
        try {
          for (const statement of statements) {
            await db.execute(statement.sql, [...(statement.params ?? [])]);
          }
          await db.execute("COMMIT");
        } catch (cause) {
          try {
            await db.execute("ROLLBACK");
          } catch {
            // Report the original failure.
          }
          throw cause;
        }
      }),
    close: async () => {
      await db.close();
    },
  };
};

export const noteIndexTauriLayer: Layer.Layer<
  NoteIndex,
  NoteIndexError,
  Vault
> = Layer.effect(
  NoteIndex,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const vault = yield* Vault;
      const paths = yield* vault
        .location()
        .pipe(
          Effect.mapError(
            (cause) => new NoteIndexError({ operation: "location", cause }),
          ),
        );
      const root = paths.root.replace(/\/+$/, "");
      const databasePath = `${root}/notty.db`;

      return yield* Effect.tryPromise({
        try: () =>
          openNoteIndex({
            root,
            databasePath,
            storage: tauriStorage,
            openDriver: () => openTauriDriver(databasePath),
          }),
        catch: (cause) => new NoteIndexError({ operation: "open", cause }),
      });
    }),
    (opened) => Effect.promise(() => opened.close()),
  ).pipe(Effect.map((opened) => opened.index)),
);
