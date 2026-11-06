# Notty v1 — Product Spec

Confirmed by grilling on 2026-11-05. This file owns product scope; implementation detail belongs in `docs/ARCHITECTURE.md`, `docs/STORAGE.md`, and `docs/EDITOR.md`.

## Promise

Dead-simple, capture-first notes that get out of your way.

Two north stars:

1. **Speed of capture** — keypress to a typable note in under a second.
2. **Apple Notes feel** — the visual and interaction language of Apple Notes.

When they conflict, capture speed wins. Capture is the reason the app exists; the feel is how it earns affection.

## Platform

- Linux desktop only in v1.
- Tauri v2 shell, Rust backend, React + TypeScript + Vite frontend.
- Distribution: `.deb` package and a tarball, with desktop entry, icon, and menu integration.

## Editor

- TipTap (ProseMirror) WYSIWYG editor, styled like Apple Notes.
- Supported objects: text, images, checklists, bold/italic, headings, lists, tables.
- Media: images only, pasted or dragged inline. Audio, video, drawing, and document scanning are out of scope.
- Images are stored once in the vault's `attachments/` directory under UUID filenames and referenced by relative path.
- Three-column layout: folders sidebar, note list, editor.
- Per-note undo/redo only. No app-wide undo, no version history.

## Capture and lifecycle

- New note via Ctrl+N or the New Note button. The note exists immediately and the cursor is in the body.
- A configurable global hotkey raises and focuses the main window from anywhere.
- Auto-save on a 300–500 ms debounce; there is no manual save.
- Title is auto-generated from creation date plus the first words of the body, and becomes user-owned once edited.
- Delete moves the note to Trash. Trashed notes are restorable for 30 days, then permanently deleted.

## Organization

- Nested folders, mirrored by directories in the vault.
- Actions: create, rename, delete, move, duplicate, pin, archive.
- Tags and Smart Folders are deferred to v1.1.

## Search

- Full-text search over note titles and bodies using SQLite FTS5.
- Fuzzy matching, debounced from the search field. No OCR, no attachment contents, no folder-name search.

## Storage

- Markdown files with light YAML frontmatter are authoritative.
- SQLite is a derived, rebuildable index that mirrors all frontmatter plus note bodies.
- One vault, auto-created at the XDG data location on first launch. The user is never asked to choose a location and is not expected to open the files.
- No sync in v1. Local, single machine.

## CLI and agent skill

- A scriptable `notty` CLI exposes the note and folder lifecycle against the same vault as the desktop app.
- It is installed as `/usr/bin/notty` by the Debian package and works while the app is running.
- Plain output is scan-friendly; `--json` provides a stable machine-readable shape.
- A bundled Agent Skill teaches coding agents to find, read, create, edit, and organise notes through the CLI. `notty skill install` installs it.

## Appearance

- Light, dark, and follow-system themes.
- First run seeds a welcome note and one or two sample notes; never reseeded.

## Licence

MIT, open source from day one. No paid tier, no account, no telemetry.
