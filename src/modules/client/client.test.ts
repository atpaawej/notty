import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryNottyClient,
  createNottyClient,
  type NottyClient,
} from "./index";

let client: NottyClient;

beforeEach(async () => {
  client = await createMemoryNottyClient();
});

afterEach(async () => {
  await client.dispose();
});

describe("NottyClient notes", () => {
  it("creates a note with a folder, title and body, then reads it back", async () => {
    const created = await client.createNote({
      folder: "Work/Projects",
      title: "Launch checklist",
      body: "Ship the CLI",
    });

    expect(created.folder).toBe("Work/Projects");
    expect(created.note.title).toBe("Launch checklist");
    expect(created.note.titleLocked).toBe(true);
    expect(created.note.body).toBe("Ship the CLI");
    await expect(client.readNote(created.note.id)).resolves.toEqual(created);
  });

  it("derives a title when the caller does not supply one", async () => {
    const created = await client.createNote({
      body: "Milk, eggs, the good bread",
    });

    expect(created.note.title).toContain("Milk, eggs");
    expect(created.note.titleLocked).toBeUndefined();
  });

  it("lists by folder, pin state and archive state", async () => {
    const root = await client.createNote({ body: "root" });
    const work = await client.createNote({ folder: "Work", body: "work" });
    const archived = await client.createNote({
      folder: "Work",
      body: "archived",
    });
    await client.pinNote(work.note.id);
    await client.archiveNote(archived.note.id);

    await expect(client.listNotes()).resolves.toMatchObject([
      { id: work.note.id },
      { id: root.note.id },
    ]);
    await expect(
      client.listNotes({ folder: "Work" }),
    ).resolves.toMatchObject([{ id: work.note.id }]);
    await expect(
      client.listNotes({ pinned: true }),
    ).resolves.toMatchObject([{ id: work.note.id }]);
    await expect(
      client.listNotes({ archived: true }),
    ).resolves.toMatchObject([{ id: archived.note.id }]);
  });

  it("appends without replacing the existing body", async () => {
    const note = await client.createNote({ body: "First line" });
    const appended = await client.appendToNote(note.note.id, "Second line");

    expect(appended.note.body).toBe("First line\nSecond line");

    const again = await client.appendToNote(note.note.id, "Third line");
    expect(again.note.body).toBe("First line\nSecond line\nThird line");
  });

  it("edits the first exact target and rejects a missing target", async () => {
    const note = await client.createNote({
      body: "alpha beta gamma",
    });

    const edited = await client.editNote(note.note.id, {
      target: "beta",
      replacement: "BETA",
    });
    expect(edited.note.body).toBe("alpha BETA gamma");

    await expect(
      client.editNote(note.note.id, "missing", "anything"),
    ).rejects.toThrow(/Target text not found/);
  });

  it("replaces the whole body", async () => {
    const note = await client.createNote({ body: "old" });
    const replaced = await client.replaceNoteBody(note.note.id, "new body");

    expect(replaced.note.body).toBe("new body");
  });

  it("renames and locks the title, moves, pins and archives", async () => {
    const note = await client.createNote({ folder: "Inbox", body: "text" });

    const renamed = await client.renameNote(note.note.id, "Locked title");
    expect(renamed.note.title).toBe("Locked title");
    expect(renamed.note.titleLocked).toBe(true);

    const moved = await client.moveNote(note.note.id, "Archive/Old");
    expect(moved.folder).toBe("Archive/Old");

    const pinned = await client.pinNote(note.note.id);
    expect(pinned.note.pinned).toBe(true);

    const archived = await client.archiveNote(note.note.id);
    expect(archived.note.archived).toBe(true);
  });

  it("duplicates a note with a new identity in the same folder", async () => {
    const note = await client.createNote({
      folder: "Templates",
      title: "Daily",
      body: "Standup notes",
    });

    const copy = await client.duplicateNote(note.note.id);

    expect(copy.note.id).not.toBe(note.note.id);
    expect(copy.folder).toBe("Templates");
    expect(copy.note.title).toBe("Daily");
    expect(copy.note.body).toBe("Standup notes");
  });

  it("trashes a note and restores it with its folder intact", async () => {
    const note = await client.createNote({
      folder: "Work",
      title: "Temporary",
      body: "recover me",
    });

    await client.trashNote(note.note.id);
    await expect(client.readNote(note.note.id)).resolves.toBeNull();
    await expect(client.listNotes({ includeArchived: true })).resolves.toEqual(
      [],
    );
    await expect(client.listTrashNotes()).resolves.toMatchObject([
      { id: note.note.id, title: "Temporary", folder: "Work" },
    ]);

    const restored = await client.restoreNote(note.note.id);
    expect(restored.note.title).toBe("Temporary");
    expect(restored.note.body).toBe("recover me");
    expect(restored.folder).toBe("Work");
    await expect(client.listTrashNotes()).resolves.toEqual([]);
  });

  it("purges a trashed note permanently", async () => {
    const note = await client.createNote({
      title: "Gone",
      body: "delete me",
    });

    await client.trashNote(note.note.id);
    await client.purgeNote(note.note.id);

    await expect(client.listTrashNotes()).resolves.toEqual([]);
    await expect(client.restoreNote(note.note.id)).rejects.toThrow();
  });

  it("searches titles and bodies", async () => {
    const groceries = await client.createNote({
      title: "Groceries",
      body: "Milk, eggs, the good bread",
    });
    await client.createNote({ title: "Errands", body: "Call the plumber" });

    await expect(client.searchNotes("grocer")).resolves.toMatchObject([
      { id: groceries.note.id },
    ]);
    await expect(client.searchNotes("plumber")).resolves.toMatchObject([
      { title: "Errands" },
    ]);
  });
});

describe("NottyClient concurrency", () => {
  it("lets two clients share one vault and index file", async () => {
    const root = await mkdtemp(join(tmpdir(), "notty-shared-"));
    const database = join(root, "notty.db");
    const app = await createNottyClient({ root, database });
    const cli = await createNottyClient({ root, database });

    try {
      const [fromApp, fromCli] = await Promise.all([
        app.createNote({ title: "From app", body: "desktop" }),
        cli.createNote({ title: "From CLI", body: "terminal" }),
      ]);

      await expect(cli.readNote(fromApp.note.id)).resolves.toMatchObject({
        note: { title: "From app" },
      });
      await expect(app.readNote(fromCli.note.id)).resolves.toMatchObject({
        note: { title: "From CLI" },
      });
    } finally {
      await app.dispose();
      await cli.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("NottyClient folders", () => {
  it("lists, creates, renames and deletes folders without losing notes", async () => {
    await client.createNote({ folder: "Work", title: "Note", body: "text" });

    await expect(client.listFolders()).resolves.toEqual(["Work"]);

    await client.createFolder("Personal");
    await expect(client.listFolders()).resolves.toEqual(["Personal", "Work"]);

    const renamed = await client.renameFolder("Work", "Office");
    expect(renamed).toBe("Office");
    await expect(client.listFolders()).resolves.toEqual(["Office", "Personal"]);
    await expect(
      client.listNotes({ folder: "Office" }),
    ).resolves.toMatchObject([{ title: "Note" }]);

    await client.deleteFolder("Personal");
    await expect(client.listFolders()).resolves.toEqual(["Office"]);
  });
});

describe("NottyClient attachments", () => {
  it("round-trips a note body with a durable attachment reference", async () => {
    const reference =
      "attachments/3b1e7f0e-6a2d-4d1a-9a0e-1b2c3d4e5f60.png";
    const body = `Before.\n\n![receipt.png](${reference})\n\nAfter.`;

    const created = await client.createNote({ body });
    expect(created.note.body).toBe(body);

    const read = await client.readNote(created.note.id);
    expect(read?.note.body).toBe(body);

    const replaced = await client.replaceNoteBody(
      created.note.id,
      `![Screenshot](${reference})`,
    );
    expect(replaced.note.body).toBe(`![Screenshot](${reference})`);

    const reloaded = await client.readNote(created.note.id);
    expect(reloaded?.note.body).toBe(`![Screenshot](${reference})`);
  });
});
