# Architecture

Six deep modules, one public interface each, wired through Effect Layers. Read this before adding a module or reaching into one.

## Design language

Use the codebase-design vocabulary exactly. **Module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**. Do not substitute *component*, *service*, *API*, or *boundary*.

- **Depth** means leverage at the interface: a lot of behaviour behind a small surface. It is not a line ratio.
- **The deletion test**: if deleting a module makes complexity vanish, it was a pass-through. If complexity reappears across callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. Needing to test past an interface means the module is the wrong shape.
- **Two adapters make a seam real.** Every seam here has a production adapter and an in-memory adapter used by tests.

See ADR-0002 for why Effect.

## Module map

```
src/modules/
  vault/        owns the vault on disk
  note-file/    owns the Markdown + frontmatter format
  note-index/   owns the SQLite index and search
  editor/       owns TipTap, wrapped
  workspace/    owns the three-column UI state
  hotkey/       owns the configurable global shortcut
```

Each folder exposes only `index.ts`. Anything else in the folder is private.

### vault

Interface: resolve the vault location, ensure it exists, store attachments, list/create/rename/delete folders, sweep expired Trash on startup, and guard the one-time welcome-note seed.

Hides: XDG path resolution, directory creation, folder path validation, the `.notty/` metadata folder, Trash retention, first-run seeding flags.

Dependency category: local-substitutable. Tests run against a temporary directory, never the real home directory.

### note-file

Interface: parse a note's file contents into a Note, and serialize a Note back to file contents.

Hides: YAML frontmatter, Markdown escaping, image reference rewriting, title derivation.

This module has no I/O. It is pure and is the primary unit-test target.

### note-index

Interface: list, get, save, search, rebuild. There is no `remove` yet — the Trash ticket extends this surface.

Ownership: `note-index` writes note files. `save` serialises with `note-file`, writes the file first, then upserts the index row. `vault` keeps creation, paths, attachments and the Trash sweep; `note-file` stays pure.

Hides: the SQLite schema, the standalone FTS5 table (synced explicitly in the same transaction as `notes`, no triggers), transaction boundaries, mirroring of frontmatter columns, rebuild-on-corruption.

Adapters: SQLite against the vault's index file (production), in-memory SQLite (tests). Both run the same SQL through the same driver seam. The rebuild path is exercised by the in-memory adapter.

### editor

Interface: a `NoteEditor` React component that takes a note body and emits Markdown, plus image intake.

Hides: TipTap, the extension set, ProseMirror node types, paste and drop handling, attachment writes.

TipTap types must never appear outside this folder. See `docs/EDITOR.md`.

### workspace

Interface: the three-column shell — selected folder, selected note, and the commands that change them, including folder create/rename/delete, moving a note, pinning, archiving and duplicating.

Hides: sidebar and note-list rendering, folder-tree indentation, keyboard shortcuts, optimistic updates, auto-save scheduling.

### hotkey

Interface: the controller that keeps one accelerator registered, the settings dialog, and the accelerator syntax helpers. Pressing the accelerator raises and focuses the main window from any application.

Hides: the Tauri global-shortcut plugin, the OS grab and its collision error, WebView local-storage persistence, the "register the new shortcut before dropping the old one" rule.

Adapters: the Tauri plugin (production), an in-memory adapter that records registrations and models shortcuts already taken by another app (tests).

## Seams

- **Storage seam** — `note-file` × `note-index` × `vault`. Tested with a temporary vault and an in-memory index. If the file and the index disagree, the file wins.
- **Editor seam** — `editor`'s Markdown in/out. Every supported object must round-trip through parse and serialize.
- **Hotkey seam** — `hotkey`'s one registered accelerator. The production adapter owns the Tauri global-shortcut plugin; the in-memory adapter records registrations and can model collisions.
- **Product seam** — the running app. Create a note, see it in the list, quit, relaunch, still there.

No module imports another module's internals. If two modules need to share a type, it lives in the module that owns the concept and the other imports it from `index.ts`.

## Effect conventions

- Each module declares its dependencies as `Context.Tag` services in `index.ts`.
- Production wiring lives in `src/main.ts` as a composed `Layer`.
- Test wiring swaps the adapter Layers; no module code changes.
- Fallible operations return typed errors, not thrown exceptions.
- Filesystem and database access always go through `Scope`-managed resources.

## Enforcement

Dependency-cruiser forbids any import that reaches past a module's `index.ts`. A violation fails CI, not review.

## Prior art in this repo

None yet. This is the first architecture document; the plan is greenfield.
