# Notty

Notty is a local-first desktop notes app for Linux. It aims at the feel of Apple Notes — open it, capture a thought, done — while keeping every note as a plain Markdown file the user actually owns.

## Language

### Content

**Note**:
A single piece of writing the user captures and edits. One note is one Markdown file in the vault.
_Avoid_: document, page, memo, item

**Folder**:
A nested container for notes. A folder is a directory inside the vault, so the folder tree and the filesystem tree are the same tree.
_Avoid_: notebook, collection, category, tag

**Vault**:
The single root directory Notty owns on the user's machine, holding all notes, folders, and attachments. Auto-created on first launch; the user never picks it.
_Avoid_: workspace, library, notebook, database

**Attachment**:
A binary file (v1: images only) stored in the vault's `attachments/` directory and referenced from a note by relative path.
_Avoid_: media, asset, file

**Trash**:
The holding state for deleted notes. A trashed note is restorable until its 30-day retention window expires, after which it is permanently deleted.
_Avoid_: recycle bin, archive, deleted

**Pin**:
A per-note flag that lifts the note to the top of its note list regardless of modification time.
_Avoid_: favourite, star, bookmark

**Archive**:
A per-note flag that removes the note from the normal note list without deleting or trashing it.
_Avoid_: hide, mute, stash

### Storage

**Frontmatter**:
The YAML block at the top of a note file holding the note's portable metadata: identity, title, timestamps, and state flags.
_Avoid_: header, metadata block, properties

**Index**:
The SQLite database that mirrors vault frontmatter and note bodies for listing and full-text search. It is derived and rebuildable: deleting it loses nothing, because the Markdown files are authoritative.
_Avoid_: database, cache, store

**Rebuild**:
The startup recovery path that reconstructs the Index by reading every note file in the vault.
_Avoid_: reindex, resync, migration

### Experience

**Capture**:
Starting a note and typing a thought with no intermediate step. Measured from keypress to a typable note body.
_Avoid_: create, compose, new note flow

**Auto-title**:
The derived note title used until the user edits it: the creation date plus the first words of the body.
_Avoid_: default title, placeholder, generated name

**Auto-save**:
Writing the note to disk on a short debounce after every edit, with no explicit save action.
_Avoid_: persist, sync, commit

**Welcome notes**:
The one-time seeded notes created on very first launch to demonstrate the editor and folder model. Never recreated after the first run.
_Avoid_: onboarding, samples, demo data

**Update**:
A newer published Notty release, staged in user space and applied on restart. A read-only system install shows a release link instead.
_Avoid_: upgrade, patch, hotfix
