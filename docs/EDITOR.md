# Editor

TipTap (ProseMirror) wrapped behind the `editor` module. Nothing outside `src/modules/editor/` may import TipTap or ProseMirror types.

## Before implementing

**Check the current TipTap documentation first.** TipTap moves quickly and training data goes stale. Choose extensions, APIs, and patterns from the current docs, not from memory. Record the version chosen when the editor module is added.

## Supported objects

Text, images, checklists, bold, italic, headings, ordered and unordered lists, and tables.

Anything that cannot survive a Markdown round-trip cannot ship in v1. See ADR-0003.

## Interface

The module exports a `NoteEditor` component that:

- takes a Markdown body and a note id,
- emits Markdown on change (the caller debounces the save),
- accepts pasted and dropped images, handing the bytes to the vault's attachments directory and inserting a relative path.

No ProseMirror editor instance escapes the module. No caller may read editor internals to render the note list or a preview.

## Serialization

- Markdown in, Markdown out. The module owns both directions.
- Parse and serialize are pure and tested independently of React.
- Round-trip is the core obligation: parse(serialize(note)) and serialize(parse(markdown)) must be stable for every supported node type.
- Empty documents serialize to an empty body, not a placeholder paragraph.

## Images

- Paste and drop are the only intake paths in v1.
- Writes go through the vault module; the editor does not decide where attachments live.
- Alt text defaults to the filename and is editable.
- No resizing, no cropping, no lightbox in v1.

## Auto-save interaction

The editor emits Markdown continuously. Debouncing and persistence belong to the workspace module, not the editor. The editor must not know about disk, SQLite, or save state.

## Undo and redo

Per-note editor history only, provided by the editor library. Notting app-wide. Switching notes resets history.
