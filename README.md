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

## CLI

`npm run build:cli` bundles the terminal client to `dist-cli/notty.js`; the Debian package installs it as `/usr/bin/notty`. It reads and writes the same XDG vault as the app, with SQLite in WAL mode so both can run at once.

```bash
notty list                       # id, title, folder per line
notty search "meeting notes"
notty read <id>                  # raw Markdown + frontmatter
notty create --title "Idea" --body "A thought"
notty append <id> "One more line"
notty folder create Work
notty skill install              # install the bundled agent skill
```

Pass `--json` for machine-readable output. `notty --help` lists every command.

## Factory

Issues labelled `agent:implement` are implemented by an AFK agent and arrive as draft PRs; you review and merge. See `docs/agents/factory.md`.

## Licence

MIT
