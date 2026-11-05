# Notty

A local-first notes app for Linux with the feel of Apple Notes. Notes are plain Markdown files you own; a SQLite index makes them searchable.

Status: v1 in development. See `docs/SPEC.md` for scope and `docs/ARCHITECTURE.md` for the module map.

## Develop

```bash
npm install
npm run tauri dev        # run the app (Linux)
npm test                 # unit tests (vitest)
npm run typecheck        # tsc --noEmit
npm run depcruise        # module boundary check (fails CI on violations)
npm run tauri build      # production build
```

CI runs the frontend checks and `cargo fmt` / `clippy` / `check` on every PR.

## Licence

MIT
