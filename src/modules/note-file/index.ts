/**
 * note-file — owns the Markdown + frontmatter format.
 *
 * Public interface: parse a note file into a Note value and serialize a Note
 * back to file contents. Also exposes auto-title derivation and attachment
 * reference helpers for the workspace.
 *
 * This module has no I/O. It is pure and is the primary unit-test target.
 */
export {
  ATTACHMENTS_DIRECTORY,
  attachmentReference,
  autoTitle,
  deriveAutoTitle,
  deriveTitle,
  imageReferences,
  isAttachmentReference,
  isInlineImageData,
  parse,
  parseNote,
  serialize,
  serializeNote,
} from "./note-file";
export type { AutoTitleOptions, Note } from "./note-file";
