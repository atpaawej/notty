/**
 * note-index — owns the SQLite index and FTS5 search.
 *
 * Public interface: list, get, save, search, rebuild. The index mirrors
 * frontmatter plus the body and is always rebuildable from the vault.
 *
 * There is no `remove` yet. Trash (#12) extends this surface; until then the
 * index only gains and updates notes.
 */
export { NoteIndex, NoteIndexError } from "./service";
export type {
  IndexedNote,
  ListOptions,
  NoteIndexShape,
  NoteSummary,
} from "./service";
export { noteIndexMemoryLayer, noteIndexNodeLayer } from "./node-adapter";
export type { NoteIndexNodeOptions } from "./node-adapter";
export { noteIndexTauriLayer } from "./tauri-adapter";
