/**
 * Private: the one extension set shared by the running editor and the pure
 * Markdown round-trip. Using the same list keeps the schema the tests exercise
 * identical to the schema real notes are saved from.
 *
 * The Markdown extension itself is added only by `NoteEditor`; `MarkdownManager`
 * already owns both directions.
 */
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

export const editorExtensions = [
  StarterKit,
  TaskList,
  TaskItem,
  TableKit,
] as const;
