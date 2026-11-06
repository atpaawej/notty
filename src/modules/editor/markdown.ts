/**
 * Private: pure Markdown in/out for the editor module.
 *
 * The manager uses the same extension set as `NoteEditor`, so the round-trip
 * exercised by tests is the round-trip the running editor performs. No React
 * and no DOM are involved.
 */
import { MarkdownManager } from "@tiptap/markdown";
import { editorExtensions } from "./extensions";

const manager = new MarkdownManager({ extensions: [...editorExtensions] });

/**
 * Parse Markdown into the editor's document model and serialize it straight
 * back. Used by tests; callers outside the module never see a TipTap type.
 */
export const normalizeMarkdown = (markdown: string): string =>
  manager.serialize(manager.parse(markdown));
