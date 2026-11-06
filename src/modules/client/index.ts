/**
 * client — the deep programmatic interface over a Notty vault.
 *
 * Public interface: `NottyClient`, its typed error, and the production and
 * in-memory adapters. Effect wiring, SQL and file paths stay private.
 */
export { NottyClientError } from "./service";
export type {
  CreateNoteInput,
  EditNoteInput,
  ListNotesOptions,
  NottyClient,
  NottyNote,
  RenameNoteOptions,
  SearchNotesOptions,
} from "./service";
export {
  createMemoryNottyClient,
  createNottyClient,
  createProductionNottyClient,
} from "./client";
export type { NottyClientOptions } from "./client";

/** Readable aliases for the two adapters. */
export {
  createMemoryNottyClient as nottyClientMemory,
  createProductionNottyClient as nottyClientProduction,
} from "./client";
