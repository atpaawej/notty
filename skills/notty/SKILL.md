---
name: notty
description: Search, read, create, and organize Notty notes from the terminal. Use when the user mentions Notty, personal notes, a note vault, saved thoughts, or asks to find, save, append to, edit, or organize notes on this Linux machine.
---

# Notty notes

`notty` is the user's local note vault on this machine. Notes are Markdown files with YAML frontmatter, and the CLI keeps the derived SQLite index in sync. Work through `notty`; reading or writing vault files directly can desynchronize the index.

## Find notes

```bash
notty list                          # active notes, newest first
notty list --folder Work --pinned
notty list --archived --limit 20
notty search "meeting notes" --limit 5
notty search plumber --all          # include archived notes
notty read <id>                     # raw Markdown + frontmatter
```

`list` and `search` print one line per note:

```text
<id>	<title>	<folder>
```

Pass `--json` to either command for an array of `{id,title,created,modified,pinned,archived,folder}`. A folder shown as `/` is the vault root.

## Capture and change notes

```bash
notty create --title "Launch checklist" --body "- [ ] Ship the CLI" --folder Work
notty create "A quick thought"                    # auto-titled
notty append <id> "- [ ] Review the draft"
notty edit <id> --target "old text" --replacement "new text"
notty edit <id> --body "A full replacement body"
notty rename <id> "Stable title"
notty move <id> Work/Projects
notty pin <id>
notty unpin <id>
notty archive <id>
notty unarchive <id>
notty duplicate <id>
notty delete <id>                   # moves to Trash, recoverable for 30 days
notty restore <id>
```

`append` adds to the end without replacing existing text. `edit --target` replaces the first exact match and fails when the target is absent. `create --title` and `rename` lock the title against auto-title regeneration.

## Folders

```bash
notty folders
notty folder create "Work/Projects"
notty folder rename "Work" "Office"
notty folder delete "Old"
```

Renaming or deleting a folder moves its notes and rebuilds the index.

## Output and errors

Plain text is the default and is token-efficient. Add `--json` to any note or folder command when you need deterministic fields. Successful commands exit `0`; usage errors exit `2`; not-found and write failures exit `1` with a message on stderr.

## Install this skill

```bash
notty skill install    # registers with the skills CLI, or writes ~/.agents/skills/notty/SKILL.md
notty skill print      # raw SKILL.md for custom agent setups
```
