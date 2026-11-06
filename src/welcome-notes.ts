/**
 * Composition-root seeding: the one-time welcome notes.
 *
 * The vault owns the first-run marker; the index owns writing note files.
 * This file owns only the copy and the order of the two calls, which is why
 * it lives beside `app-runtime.ts` rather than inside a module. Tests can run
 * the same effect against a temporary vault.
 */
import { Effect } from "effect";
import type { Note } from "./modules/note-file";
import { NoteIndex, type NoteIndexError } from "./modules/note-index";
import { Vault, type VaultError } from "./modules/vault";

/** Fixed ids keep a retried seed from duplicating a note that already landed. */
const WELCOME_ID = "6f0b3a62-7d4e-4b1f-9a3c-1d2e3f4a5b60";
const LISTS_SAMPLE_ID = "6f0b3a62-7d4e-4b1f-9a3c-1d2e3f4a5b61";
const TABLE_SAMPLE_ID = "6f0b3a62-7d4e-4b1f-9a3c-1d2e3f4a5b62";

const SEED_IDS: ReadonlySet<string> = new Set([
  WELCOME_ID,
  LISTS_SAMPLE_ID,
  TABLE_SAMPLE_ID,
]);

const WELCOME_BODY = [
  "# Welcome to Notty",
  "",
  "Notty is a notes app for Linux. Open it, type a thought, and it lands in a plain Markdown file inside a folder you own.",
  "",
  "## Capture something",
  "",
  "Press `Ctrl+N` or click **New Note**. The note is ready and the cursor is in the body. There is no save button; Notty writes as you go.",
  "",
  "A global hotkey raises the window while you are in another app. The default is `Ctrl+Shift+Space`, and you can change it in Settings.",
  "",
  "## Find it again",
  "",
  "Press `Esc` to close search. Type a few letters and Notty matches titles and bodies as you type, including near-miss spellings.",
  "",
  "## Keep it tidy",
  "",
  "- **Pin** holds a note at the top of the list.",
  "- **Archive** clears a note from the list without deleting it.",
  "- **Delete** sends a note to Trash, where it stays for 30 days.",
  "- **Folders** group notes in the sidebar. A folder is a directory in your vault, so moving a note moves the file.",
  "",
  "## Your files, on your machine",
  "",
  "Your vault lives in your local data directory. Notes are Markdown, images sit beside them in `attachments/`, and a SQLite index keeps listing and search quick. Delete the index and Notty rebuilds it from your files on the next launch.",
  "",
  "The two sample notes show headings, checklists, lists, tables, and images. They are ordinary notes, so edit them, move them, or delete them.",
].join("\n");

const LISTS_SAMPLE_BODY = [
  "# Sample: lists and an image",
  "",
  "This is an ordinary note. Type anywhere in it, press `Ctrl+N` for a new one, and delete it when you are done.",
  "",
  "## A checklist",
  "",
  "- [ ] Draft the announcement",
  "- [x] Make coffee",
  "- [ ] Send it before lunch",
  "",
  "## Lists",
  "",
  "1. Raise Notty with `Ctrl+Shift+Space`.",
  "2. Type the thought before it escapes.",
  "3. Close the window. The note is already saved.",
  "",
  "- Milk, eggs, the good bread",
  "- Fix the bike, call Mum",
  "- Finish *The Left Hand of Darkness*",
  "",
  "## An image",
  "",
  "![A small illustration drawn in one line](NOTTY_WELCOME_IMAGE)",
  "",
  "Paste or drop an image into any note. Notty stores the file in `attachments/` and references it from the Markdown, so the note stays portable.",
].join("\n");

const TABLE_SAMPLE_BODY = [
  "# Sample: a table",
  "",
  "Tables edit in place. Click a cell and type.",
  "",
  "| Day | Plan | Done |",
  "| --- | --- | --- |",
  "| Monday | Write the first paragraph | Yes |",
  "| Tuesday | Cut it in half | Yes |",
  "| Wednesday | Read it out loud | Mostly |",
  "",
  "## A little emphasis",
  "",
  "**Bold** for the urgent bit. *Italic* for titles and asides. Headings give a long note places to land.",
  "",
  "Tables keep their shape when you save and reopen.",
].join("\n");

/** A warm, hand-drawn line on paper. Seeded as a real attachment. */
const WELCOME_IMAGE = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="220" viewBox="0 0 480 220" role="img" aria-label="A note drawn as one loose line">',
  '  <rect width="480" height="220" rx="20" fill="#f6f0e4"/>',
  '  <path d="M96 152 C 146 44, 232 202, 292 96 S 382 54, 396 118" fill="none" stroke="#c9762f" stroke-width="8" stroke-linecap="round"/>',
  '  <circle cx="356" cy="168" r="9" fill="#3d3a34"/>',
  "</svg>",
  "",
].join("\n");

const noteAt = (
  id: string,
  title: string,
  body: string,
  created: string,
): Note => ({
  id,
  title,
  created,
  modified: created,
  pinned: false,
  archived: false,
  titleLocked: true,
  body,
});

const secondsBefore = (now: Date, seconds: number): string =>
  new Date(now.getTime() - seconds * 1000).toISOString();

const welcomeNotes = (
  now: Date,
  imagePath: string,
): ReadonlyArray<Note> => [
  noteAt(WELCOME_ID, "Welcome to Notty", WELCOME_BODY, now.toISOString()),
  noteAt(
    LISTS_SAMPLE_ID,
    "Sample: lists and an image",
    LISTS_SAMPLE_BODY.split("NOTTY_WELCOME_IMAGE").join(imagePath),
    secondsBefore(now, 1),
  ),
  noteAt(
    TABLE_SAMPLE_ID,
    "Sample: a table",
    TABLE_SAMPLE_BODY,
    secondsBefore(now, 2),
  ),
];

/**
 * Seed the welcome notes on the first launch and never again.
 *
 * A vault that holds notes other than a half-finished seed is treated as past
 * its first run: it gets the marker, no samples, so an existing install is
 * never filled with demo content. The marker is written last, so a seed that
 * failed partway retries on the next launch with the same ids.
 */
export const seedWelcomeNotes = (): Effect.Effect<
  void,
  VaultError | NoteIndexError,
  Vault | NoteIndex
> =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const index = yield* NoteIndex;

    if (yield* vault.hasSeededWelcomeNotes()) return;

    const existing = yield* index.list({ includeArchived: true });
    const userNotes = existing.filter((note) => !SEED_IDS.has(note.id));
    if (userNotes.length > 0) {
      yield* vault.markWelcomeNotesSeeded();
      return;
    }

    const now = new Date();
    const image = yield* vault.saveAttachment({
      bytes: new TextEncoder().encode(WELCOME_IMAGE),
      name: "notty-welcome.svg",
      mimeType: "image/svg+xml",
    });

    for (const note of welcomeNotes(now, image.path)) {
      yield* index.save(note, "");
    }

    yield* vault.markWelcomeNotesSeeded();
  });
