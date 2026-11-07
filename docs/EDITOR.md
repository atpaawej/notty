# Editor

TipTap (ProseMirror) wrapped behind the `editor` module. Nothing outside `src/modules/editor/` may import TipTap or ProseMirror types.

## Before implementing

**Check the current TipTap documentation first.** TipTap moves quickly and training data goes stale. Choose extensions, APIs, and patterns from the current docs, not from memory. Record the version chosen when the editor module is added.

Chosen for the capture ticket: TipTap **3.32.3** (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/pm`). Checklists use `TaskList` + `TaskItem` from `@tiptap/extension-list`; tables use `TableKit` from `@tiptap/extension-table`; images use `@tiptap/extension-image` with base64 parsing disabled. StarterKit supplies text, bold, italic, headings and ordered/unordered lists; the Markdown extension supplies `contentType: "markdown"` on input and `editor.getMarkdown()` on output, and its manager is the pure parse/serialize path tested without React.

The running editor and the pure Markdown manager share one extension set (`extensions.ts`), so a round-trip test exercises the same schema a saved note uses.

## Supported objects

Text, images, checklists, bold, italic, headings, ordered and unordered lists, and tables.

Anything that cannot survive a Markdown round-trip cannot ship in v1. See ADR-0003.

## Interface

The module exports a `NoteEditor` component that:

- takes a Markdown body and a note id,
- emits Markdown after a short serialization debounce or on blur, not on every keystroke,
- reports whether keystrokes are still waiting to be serialized (`onDirtyChange`) so the caller can protect an in-flight draft from an external write,
- accepts pasted and dropped images, handing the bytes to the vault's attachments directory and inserting a relative path.

No ProseMirror editor instance escapes the module. No caller may read editor internals to render the note list or a preview.

One TipTap instance stays mounted for the life of the workspace. Changing `noteId` swaps the document, resets history and keeps the WebKitGTK instantiation cost out of note switching. A later `body` value replaces the document only when the buffer is clean; dirty keystrokes always win, and a clean swap clamps the existing selection to the new document size.

## Serialization

- Markdown in, Markdown out. The module owns both directions.
- Parse and serialize are pure and tested independently of React.
- `getMarkdown()` runs once after 300 ms of quiet typing (`SERIALIZE_DELAY_MS`) or immediately on blur, so a keystroke never pays the serialization cost.
- Round-trip is the core obligation: parse(serialize(note)) and serialize(parse(markdown)) must be stable for every supported node type.
- Empty documents serialize to an empty body, not a placeholder paragraph.

## Images

- Paste and drop are the only intake paths in v1.
- Writes go through the vault module; the editor does not decide where attachments live.
- The editor receives the resulting relative reference and inserts it as an image node. Markdown keeps that reference; only HTML rendering maps it to a webview URL through a resolver supplied by the composition root.
- Base64 parsing is disabled, so an inline image payload can never enter a note through the editor.
- On Linux, WebKitGTK can deliver an empty paste payload for screenshots. When the DOM payload has no data at all, the editor asks the composition root's clipboard reader for system pixels. The Tauri adapter reads the OS clipboard and encodes PNG bytes; non-Tauri and test adapters return `null` without failing the paste.
- A document watcher persists any image whose `src` is a transient `blob:` or `data:` URL, then rewrites the node to the relative attachment path. Markdown rendering drops transient URLs as a final guard, so an ephemeral webview URL is never written to a note file.
- Alt text defaults to the original filename and is edited from the toolbar while an image is selected.
- No resizing, no cropping, no lightbox in v1.

## Auto-save interaction

The editor serializes after its own 300 ms quiet period and on blur, then hands the Markdown to the workspace. Persistence debouncing, disk, SQLite and save state stay outside the editor. The workspace treats `onDirtyChange(true)` as ownership: an external change to the open file never replaces a dirty buffer.

## Undo and redo

Per-note editor history only, provided by the editor library. Never app-wide. Switching notes resets history in place: TipTap 3.32 has no `clearHistory` command, so `resetEditorHistory` rebuilds `EditorState` with the same document and plugins while keeping the mounted view.
