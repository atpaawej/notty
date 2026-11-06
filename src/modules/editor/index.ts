/**
 * editor — owns TipTap, wrapped.
 *
 * Public interface: a `NoteEditor` React component that takes Markdown and
 * emits Markdown, plus `normalizeMarkdown` for the pure parse/serialize
 * round-trip. No TipTap or ProseMirror type escapes this folder.
 */
export { NoteEditor } from "./NoteEditor";
export type {
  ImageUpload,
  NoteEditorProps,
  SaveImage,
  StoredImage,
} from "./NoteEditor";
export { normalizeMarkdown } from "./markdown";
