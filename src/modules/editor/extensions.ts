/**
 * Private: the one extension set shared by the running editor and the pure
 * Markdown round-trip. Using the same list keeps the schema the tests exercise
 * identical to the schema real notes are saved from.
 *
 * The Markdown extension itself is added only by `NoteEditor`; `MarkdownManager`
 * already owns both directions.
 */
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  Table,
  TableKit,
  renderTableToMarkdown,
} from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { isTransientImageSource } from "./image-intake";

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

/**
 * A vault-relative attachment reference is what the note file stores, but the
 * webview cannot load it directly. The caller supplies the mapping to a
 * displayable URL; Markdown output keeps the original reference because only
 * `renderHTML` is overridden.
 */
const attachmentImage = (resolveImageSrc: (path: string) => string) =>
  Image.extend({
    renderHTML({ HTMLAttributes }) {
      const src =
        typeof HTMLAttributes.src === "string"
          ? resolveImageSrc(HTMLAttributes.src)
          : HTMLAttributes.src;
      return ["img", { ...HTMLAttributes, src }];
    },
    renderMarkdown(node) {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      // The watcher normally rewrites these first. If it has not finished (or
      // failed), never leak a webview-only URL into the user's note file.
      if (isTransientImageSource(src)) {
        console.warn("Notty blocked a transient image URL from being saved");
        return "";
      }
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const title =
        typeof node.attrs?.title === "string" ? node.attrs.title : "";
      return title.length > 0
        ? `![${alt}](${src} "${title}")`
        : `![${alt}](${src})`;
    },
  }).configure({ allowBase64: false });

const baseExtensions = [
  StarterKit,
  TaskList,
  TaskItem,
  TableKit.configure({ table: false }),
  MarkdownTable,
] as const;

/**
 * The one extension set shared by the running editor and the pure Markdown
 * round-trip. `resolveImageSrc` affects rendering only, never serialization.
 */
export const createEditorExtensions = (
  resolveImageSrc: (path: string) => string = (path) => path,
) => [...baseExtensions, attachmentImage(resolveImageSrc)] as const;

export const editorExtensions = createEditorExtensions();

