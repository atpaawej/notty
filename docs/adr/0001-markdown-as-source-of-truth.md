# Markdown files are the source of truth; SQLite is a rebuildable index

Notty stores each note as a Markdown file with YAML frontmatter inside the vault, and keeps a SQLite database beside it purely as a derived index for listing and full-text search. Deleting the database loses nothing: startup rebuilds it from the files.

We chose this over the conventional "database is the store, files are an export" design because the product promise is that notes belong to the user. A vault that can be opened in any editor, read without Notty, and backed up by copying a folder is worth more than the query flexibility we give up. Every frontmatter field is mirrored into the index so listing and search never re-parse files.

**Consequences:** The Index must tolerate being stale or absent, so every read path needs a rebuild fallback. Any write must land in the file first and the Index second; the Index is never allowed to be ahead of disk.
