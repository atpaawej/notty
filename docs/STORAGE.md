# Storage

The vault is the user's data. Everything else in Notty is rebuildable.

## Vault layout

```
<XDG data home>/notty/vault/
  notty.db            SQLite index (derived)
  attachments/        images, UUID filenames
  .notty/             internal flags, never user content
  .trash/             trashed notes, mirroring the folder tree
  <folders...>/
    <note>.md
```

The `.notty/` folder holds the first-run marker for the welcome notes. It is invisible in the sidebar and never holds a note.

The vault is created on first launch at the XDG data location. The user is never prompted to choose a path and never needs to know it exists.

## Note file format

A note file is YAML frontmatter followed by a Markdown body.

```markdown
---
id: 0f9c2b7e-...
title: Groceries
created: 2026-11-05T09:14:00Z
modified: 2026-11-05T09:31:12Z
pinned: false
archived: false
titleLocked: true
---

Milk, eggs, the good bread.

![receipt](attachments/3b1e....png)
```

Rules:

- `id` is stable for the life of the note; renaming or moving never changes it.
- `title` is stored, not derived at read time. Auto-title writes it only while the user has not edited it.
- `titleLocked: true` records that the user owns the title. It is omitted until then, so older notes keep their exact frontmatter.
- `created` and `modified` are ISO 8601 UTC.
- `pinned` and `archived` are booleans. Folder membership is the file's directory, not a frontmatter field.
- Image references are relative paths into `attachments/`. Base64 payloads are forbidden.
- Unknown frontmatter keys are preserved on write. A future field must not be destroyed by an older build.

## The index

SQLite holds one row per note mirroring every frontmatter field plus the body text. FTS5 indexes title and body.

Rules:

- The file is written first, the index second. The index is never ahead of disk.
- If the index is missing, stale, or corrupt, startup rebuilds it from the vault.
- Search and listing read only from the index, never by re-parsing files.
- Deleting `notty.db` at any time is safe.
- The app and the CLI may use the index at the same time. SQLite runs in WAL mode with a busy timeout, so short write overlaps wait instead of failing. A stale index is rebuilt in place; the database file is only removed when it is corrupt.

## Attachments

- Written to `attachments/` at the vault root with a UUID filename and the original extension.
- Never copied per note. One file, many references if needed.
- A note's deleted image is left in place in v1; garbage collection is out of scope.

## Trash

- Deleting a note moves it under `.trash/` rather than unlinking it.
- The Trash mirrors the vault folder tree, so restore puts the note back in its original folder without extra metadata.
- Trashed notes are restorable for 30 days.
- A startup sweep permanently deletes anything past retention.
- Retention is a vault concern, not an index concern.
