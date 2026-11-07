# Architecture

Eight deep modules, one public interface each, wired through Effect Layers. Read this before adding a module or reaching into one.

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
  client/       owns the Promise surface over a vault
  editor/       owns TipTap, wrapped
  workspace/    owns the three-column UI state
  hotkey/       owns the configurable global shortcut
  updater/      owns release checks, staging and restart
```

Each folder exposes only `index.ts`. Anything else in the folder is private.

### vault

Interface: resolve the vault location, ensure it exists, store attachments, list/create/rename/delete folders, sweep expired Trash on startup, guard the one-time welcome-note seed, and watch the vault for external changes.

Hides: XDG path resolution, directory creation, folder path validation, the `.notty/` metadata folder, Trash retention, first-run seeding flags, the OS watch, path filtering, and event debouncing.

Adapters: the Tauri filesystem watch (production) and an in-memory watcher that emits filtered events synchronously (tests and non-Tauri runtimes).

Dependency category: local-substitutable. Tests run against a temporary directory, never the real home directory.

### note-file

Interface: parse a note's file contents into a Note, and serialize a Note back to file contents.

Hides: YAML frontmatter, Markdown escaping, image reference rewriting, title derivation.

This module has no I/O. It is pure and is the primary unit-test target.

### note-index

Interface: list, get, save, search, syncFile, trash, restore, rebuild.

Ownership: `note-index` writes note files. `save` serialises with `note-file`, writes the file first, then upserts the index row. `syncFile` reconciles one externally changed path from a single read and reports `ignored`, `unchanged` (the fingerprint matched, but the indexed note comes back for callers whose in-memory list may be stale), `removed` or `upserted`. `trash` moves the file under `.trash/` before deleting its row; `restore` reverses that using the path below `.trash/`. `vault` keeps creation, paths, attachments and the Trash sweep; `note-file` stays pure.

Hides: the SQLite schema, the standalone FTS5 table (synced explicitly in the same transaction as `notes`, no triggers), transaction boundaries, mirroring of frontmatter columns, stat fingerprints that suppress the echo of Notty's own save, path-derived ids for raw Markdown, WAL and busy-timeout connection settings, rebuild-on-corruption.

Adapters: SQLite against the vault's index file (production), in-memory SQLite (tests). Both run the same SQL through the same driver seam. The rebuild path is exercised by the in-memory adapter.

### client

Interface: one `NottyClient` over a vault — list, search, read, create, append, edit, replace, rename, move, pin, archive, duplicate, trash, restore, folder lifecycle, and `dispose`.

Hides: Effect runtimes and Layers, the order of file and index writes, title derivation, identity and clock seams, and the conversion of typed module errors into one `NottyClientError`.

Adapters: the production client resolves the XDG vault and its `notty.db`; the memory client uses a temporary directory and in-memory SQLite. Tests cross the same interface as the CLI. See `src/cli/` for the terminal adapter over this module.

### editor

Interface: a `NoteEditor` React component that takes a note body and emits Markdown, plus image intake.

Hides: TipTap, the extension set, ProseMirror node types, paste and drop handling, native clipboard fallback, transient blob persistence, attachment writes.

TipTap types must never appear outside this folder. See `docs/EDITOR.md`.

### workspace

Interface: the three-column shell — selected folder, selected note, and the commands that change them, including folder create/rename/delete, moving a note, pinning, archiving and duplicating.

Hides: sidebar and note-list rendering, folder-tree indentation, keyboard shortcuts, optimistic updates, auto-save scheduling, realtime reconciliation of external vault events, and protection of a dirty editor buffer from an external overwrite.

### hotkey

Interface: the controller that keeps one accelerator registered, the settings dialog, and the accelerator syntax helpers. Pressing the accelerator raises and focuses the main window from any application.

Hides: the Tauri global-shortcut plugin, the OS grab and its collision error, WebView local-storage persistence, the "register the new shortcut before dropping the old one" rule.

Adapters: the Tauri plugin (production), an in-memory adapter that records registrations and models shortcuts already taken by another app (tests).

### updater

Interface: a reactive controller that checks GitHub Releases, downloads and stages a user-space update, offers restart, and exposes the banner. States are `Idle`, `Checking`, `UpToDate`, `Available`, `Downloading`, `ReadyToRestart` and `Failed`; failures never throw at callers.

Hides: release scheduling, version comparison, permission probing, the download/stage/verify sequence, temporary directories, and the pre-restart flush. A read-only system install stops at `Available` with `isUserSpace: false` and a release link.

Adapters: the Tauri shell (production) and an in-memory adapter that models user-space, read-only, failed and partial-download cases without network or disk I/O (tests).

## Seams

- **Storage seam** — `note-file` × `note-index` × `vault`. Tested with a temporary vault and an in-memory index. If the file and the index disagree, the file wins.
- **Vault-watch seam** — `vault`'s `VaultWatcher`. Production watches the OS through Tauri and debounces bursts; the in-memory adapter emits the same filtered events synchronously for tests. `note-index` reconciles one path, `workspace` applies the result to the list and the open editor.
- **Editor seam** — `editor`'s Markdown in/out. Every supported object must round-trip through parse and serialize.
- **Hotkey seam** — `hotkey`'s one registered accelerator. The production adapter owns the Tauri global-shortcut plugin; the in-memory adapter records registrations and can model collisions.
- **Updater seam** — `updater`'s GitHub check, staged download and restart. The Tauri adapter talks to the shell; the memory adapter models every state without I/O.
- **Client seam** — `client`'s Promise methods. The CLI and tests use the same interface; the production adapter opens the XDG vault, the memory adapter opens a temporary one.
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
