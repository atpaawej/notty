/**
 * Private: the one extension set shared by the running editor and the pure
 * Markdown round-trip. Using the same list keeps the schema the tests exercise
 * identical to the schema real notes are saved from.
 *
 * The Markdown extension itself is added only by `NoteEditor`; `MarkdownManager`
 * already owns both directions.
 */
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  Table,
  TableKit,
  renderTableToMarkdown,
} from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

/**
 * The stock table renderer adds its own leading and trailing newlines. The
 * Markdown manager already separates block nodes, so those extra lines turn
 * into empty paragraphs — and two adjacent tables drift further apart on every
 * save. Trim them here so table output is a normal block.
 */
const MarkdownTable = Table.extend({
  renderMarkdown(node, helpers) {
    return renderTableToMarkdown(node, helpers).trim();
  },
});

export const editorExtensions = [
  StarterKit,
  TaskList,
  TaskItem,
  TableKit.configure({ table: false }),
  MarkdownTable,
] as const;
