# Notty

Local-first, capture-first notes for Linux, in the feel of Apple Notes.

Tauri v2 desktop app: Rust shell in `src-tauri/`, React + TypeScript + Vite frontend in `src/`. TipTap editor. Markdown files are the source of truth; SQLite is a rebuildable index.

Package manager: npm.
Dev: `npm run tauri dev`. Build: `npm run tauri build` (Linux `.deb` + tarball).
Checks: `npm run typecheck`, `npm test`, `npm run depcruise`.

## Read only what you need

- Product scope: `docs/SPEC.md`
- Module map, seams, Effect conventions: `docs/ARCHITECTURE.md`
- Vault, Markdown format, index: `docs/STORAGE.md`
- Editor and TipTap rules: `docs/EDITOR.md`
- Domain vocabulary: `GLOSSARY.md`
- Decisions: `docs/adr/`

## Design

Use the codebase-design vocabulary exactly: **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**. Avoid *component*, *service*, *API*, *boundary*.

One module, one public interface at `index.ts`. Never import past it. Every seam has a production adapter and an in-memory adapter.

## Before writing editor code

Check the current TipTap docs. Do not rely on memory; the API changes.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles map to the same label strings in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Factory

AFK runs are triggered by `agent:implement` on an issue. The rules they obey (branching, commits, checks, no GitHub mutations) live in `docs/agents/factory.md` — read it first if this session was dispatched by the factory. Humans merge.

## Grilling sessions

When grilling, ask one question at a time.
