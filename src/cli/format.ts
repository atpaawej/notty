/**
 * Output formatting. Plain text by default; `--json` adds a stable shape.
 */
import { serialize } from "../modules/note-file";
import type { NottyNote } from "../modules/client";
import type { NoteSummary } from "../modules/note-index";

export interface NoteSummaryJson {
  readonly id: string;
  readonly title: string;
  readonly created: string;
  readonly modified: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly folder: string;
}

export interface NoteJson extends NoteSummaryJson {
  readonly titleLocked: boolean;
  readonly body: string;
}

export const summaryJson = (note: NoteSummary): NoteSummaryJson => ({
  id: note.id,
  title: note.title,
  created: note.created,
  modified: note.modified,
  pinned: note.pinned,
  archived: note.archived,
  folder: note.folder,
});

export const noteJson = (entry: NottyNote): NoteJson => ({
  ...summaryJson({
    id: entry.note.id,
    title: entry.note.title,
    created: entry.note.created,
    modified: entry.note.modified,
    pinned: entry.note.pinned,
    archived: entry.note.archived,
    folder: entry.folder,
  }),
  titleLocked: entry.note.titleLocked === true,
  body: entry.note.body,
});

export const json = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

/** One scan-friendly line: id, title, folder, then state markers. */
export const summaryLine = (note: NoteSummary): string => {
  const folder = note.folder.length === 0 ? "/" : note.folder;
  const markers = [
    note.pinned ? "pinned" : undefined,
    note.archived ? "archived" : undefined,
  ].filter((marker): marker is string => marker !== undefined);
  return [
    note.id,
    note.title,
    folder,
    ...markers,
  ].join("\t");
};

export const summaryLines = (
  notes: ReadonlyArray<NoteSummary>,
): string => notes.map(summaryLine).join("\n") + (notes.length > 0 ? "\n" : "");

export const noteMarkdown = (entry: NottyNote): string => {
  const markdown = serialize(entry.note);
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
};
