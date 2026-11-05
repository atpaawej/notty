/**
 * Browser-side production wiring: one composed Layer for the WebView.
 *
 * The Tauri vault adapter supplies the location and filesystem; the Tauri
 * note-index adapter adds SQLite. The rest of the app sees only `NoteStore`.
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  NoteIndex,
  noteIndexTauriLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "./modules/note-index";
import { vaultTauriLayer } from "./modules/vault";
import type { NoteStore } from "./modules/workspace";

const indexLayer = noteIndexTauriLayer.pipe(Layer.provide(vaultTauriLayer));
const runtime = ManagedRuntime.make(indexLayer);

const withIndex = <A>(
  run: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
): Promise<A> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return yield* run(index);
    }),
  );

export const noteStore: NoteStore = {
  list: () => withIndex((index) => index.list()),
  get: (id) => withIndex((index) => index.get(id)),
  save: (note, folder) => withIndex((index) => index.save(note, folder)),
};
