import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NottyClient, NottyNote } from "../modules/client";
import type { NoteSummary } from "../modules/note-index";
import { CliUsageError, parseArgv } from "./args";
import { runCli, type CliHooks } from "./run";
import { installSkill } from "./skill";

const summary = (overrides: Partial<NoteSummary> = {}): NoteSummary => ({
  id: "note-1",
  title: "Groceries",
  created: "2026-11-06T09:00:00Z",
  modified: "2026-11-06T10:00:00Z",
  pinned: false,
  archived: false,
  folder: "Life",
  ...overrides,
});

const entry = (overrides: Partial<NottyNote["note"]> = {}): NottyNote => ({
  note: {
    id: "note-1",
    title: "Groceries",
    created: "2026-11-06T09:00:00Z",
    modified: "2026-11-06T10:00:00Z",
    pinned: false,
    archived: false,
    body: "Milk, eggs",
    ...overrides,
  },
  folder: "Life",
});

const fakeClient = (overrides: Partial<NottyClient> = {}): NottyClient => ({
  listNotes: vi.fn(async () => [summary()]),
  searchNotes: vi.fn(async () => [summary()]),
  readNote: vi.fn(async () => entry()),
  createNote: vi.fn(async () => entry()),
  appendToNote: vi.fn(async () => entry()),
  editNote: vi.fn(async () => entry()),
  replaceNoteBody: vi.fn(async () => entry()),
  renameNote: vi.fn(async () => entry()),
  moveNote: vi.fn(async () => entry()),
  pinNote: vi.fn(async () => entry()),
  archiveNote: vi.fn(async () => entry()),
  duplicateNote: vi.fn(async () => entry()),
  trashNote: vi.fn(async () => undefined),
  restoreNote: vi.fn(async () => entry()),
  listFolders: vi.fn(async () => ["Life", "Work"]),
  createFolder: vi.fn(async (folder: string) => folder),
  renameFolder: vi.fn(async (_folder: string, next: string) => next),
  deleteFolder: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  list: vi.fn(async () => [summary()]),
  search: vi.fn(async () => [summary()]),
  get: vi.fn(async () => entry()),
  setPinned: vi.fn(async () => entry()),
  setArchived: vi.fn(async () => entry()),
  ...overrides,
});

const hooks = (
  client: NottyClient,
  overrides: Partial<CliHooks> = {},
): CliHooks & { readonly out: string[]; readonly err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    openClient: async () => client,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    version: "0.1.1",
    out,
    err,
    ...overrides,
  };
};

describe("parseArgv", () => {
  it("parses list filters and --json", () => {
    expect(
      parseArgv([
        "list",
        "--folder",
        "Work",
        "--pinned",
        "--all",
        "--limit",
        "5",
        "--json",
      ]),
    ).toEqual({
      kind: "list",
      json: true,
      folder: "Work",
      pinned: true,
      includeArchived: true,
      limit: 5,
    });
  });

  it("joins an unquoted search query", () => {
    expect(parseArgv(["search", "meeting", "notes"])).toMatchObject({
      kind: "search",
      query: "meeting notes",
      json: false,
    });
  });

  it("parses create flags and a positional body", () => {
    expect(
      parseArgv(["create", "--title", "Idea", "A thought"]),
    ).toMatchObject({
      kind: "create",
      title: "Idea",
      body: "A thought",
    });
  });

  it("parses exact editing and whole-body replacement", () => {
    expect(
      parseArgv([
        "edit",
        "note-1",
        "--target",
        "old",
        "--replacement",
        "new",
      ]),
    ).toMatchObject({
      kind: "edit",
      id: "note-1",
      target: "old",
      replacement: "new",
    });

    expect(parseArgv(["edit", "note-1", "--body", "fresh"])).toMatchObject({
      kind: "edit",
      id: "note-1",
      body: "fresh",
    });
  });

  it("parses folder lifecycle commands", () => {
    expect(parseArgv(["folder", "create", "Work"])).toMatchObject({
      kind: "folder-create",
      folder: "Work",
    });
    expect(parseArgv(["folder", "rename", "Work", "Office"])).toMatchObject({
      kind: "folder-rename",
      folder: "Work",
      nextFolder: "Office",
    });
    expect(parseArgv(["folder", "delete", "Work"])).toMatchObject({
      kind: "folder-delete",
      folder: "Work",
    });
  });

  it("rejects unknown options and missing ids", () => {
    expect(() => parseArgv(["list", "--nope"])).toThrow(CliUsageError);
    expect(() => parseArgv(["read"])).toThrow(/note id is required/i);
    expect(() => parseArgv(["edit", "note-1", "--target", "x"])).toThrow(
      /--replacement/,
    );
  });
});

describe("runCli output", () => {
  it("prints tab-separated summaries by default and JSON on request", async () => {
    const client = fakeClient();
    const text = hooks(client);
    expect(await runCli(["list"], text)).toBe(0);
    expect(text.out.join("")).toBe("note-1\tGroceries\tLife\n");

    const structured = hooks(client);
    expect(await runCli(["list", "--json"], structured)).toBe(0);
    expect(JSON.parse(structured.out.join(""))).toEqual([
      summary(),
    ]);
  });

  it("prints raw Markdown and frontmatter for read", async () => {
    const read = hooks(fakeClient());
    expect(await runCli(["read", "note-1"], read)).toBe(0);

    const output = read.out.join("");
    expect(output).toContain("---\nid: note-1");
    expect(output).toContain("title: Groceries");
    expect(output).toContain("Milk, eggs");
  });

  it("prints note JSON for mutations", async () => {
    const create = hooks(fakeClient());
    expect(
      await runCli(
        ["create", "--title", "New", "--body", "Body", "--json"],
        create,
      ),
    ).toBe(0);

    const output = JSON.parse(create.out.join(""));
    expect(output).toMatchObject({
      id: "note-1",
      title: "Groceries",
      folder: "Life",
      body: "Milk, eggs",
    });
  });

  it("prints trash and restore results", async () => {
    const trash = hooks(fakeClient());
    expect(await runCli(["delete", "note-1"], trash)).toBe(0);
    expect(trash.out.join("")).toBe("Trashed note-1\n");

    const restore = hooks(fakeClient());
    expect(await runCli(["restore", "note-1"], restore)).toBe(0);
    expect(restore.out.join("")).toContain("note-1\tGroceries\tLife");
  });

  it("prints folders one per line", async () => {
    const folders = hooks(fakeClient());
    expect(await runCli(["folders"], folders)).toBe(0);
    expect(folders.out.join("")).toBe("Life\nWork\n");
  });
});

describe("runCli errors", () => {
  it("returns 2 for usage errors", async () => {
    const usage = hooks(fakeClient());
    expect(await runCli(["nope"], usage)).toBe(2);
    expect(usage.err.join("")).toContain("Unknown command: nope");
    expect(usage.err.join("")).toContain("Run 'notty --help'");
  });

  it("returns 1 when a note is missing", async () => {
    const missing = hooks(
      fakeClient({ readNote: vi.fn(async () => null) }),
    );
    expect(await runCli(["read", "missing"], missing)).toBe(1);
    expect(missing.err.join("")).toBe("notty: Note not found: missing\n");
  });

  it("returns 1 and keeps stderr clean of stack traces on client errors", async () => {
    const failing = hooks(
      fakeClient({
        createNote: vi.fn(async () => {
          throw new Error("disk is full");
        }),
      }),
    );
    expect(await runCli(["create"], failing)).toBe(1);
    expect(failing.err.join("")).toBe("notty: disk is full\n");
    expect(failing.out).toEqual([]);
  });

  it("always disposes the client", async () => {
    const client = fakeClient();
    const dispose = hooks(client);
    await runCli(["list"], dispose);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("runCli skills", () => {
  it("prints the embedded SKILL.md", async () => {
    const print = hooks(fakeClient(), { skillText: "# Skill\n" });
    expect(await runCli(["skill", "print"], print)).toBe(0);
    expect(print.out.join("")).toBe("# Skill\n");
  });

  it("reports a skills-CLI install and a fallback install", async () => {
    const viaCli = hooks(fakeClient(), {
      installSkill: async () => ({ method: "skills" }),
    });
    expect(await runCli(["skill", "install"], viaCli)).toBe(0);
    expect(viaCli.out.join("")).toBe(
      "Installed the Notty skill with the skills CLI.\n",
    );

    const viaFile = hooks(fakeClient(), {
      installSkill: async () => ({
        method: "file",
        path: "/home/test/.agents/skills/notty/SKILL.md",
      }),
    });
    expect(
      await runCli(["skill", "install", "--json"], viaFile),
    ).toBe(0);
    expect(JSON.parse(viaFile.out.join(""))).toEqual({
      installed: true,
      method: "file",
      path: "/home/test/.agents/skills/notty/SKILL.md",
    });
  });
});

describe("installSkill", () => {
  it("uses the skills CLI when it succeeds", async () => {
    const run = vi.fn(() => ({ status: 0 }));

    await expect(
      installSkill({ command: "skills", run, home: "/home/test" }),
    ).resolves.toEqual({ method: "skills" });
    expect(run).toHaveBeenCalledWith("skills", [
      "add",
      "atpaawej/notty",
      "-g",
      "-y",
    ]);
  });

  it("writes SKILL.md under the agent skill folder as a fallback", async () => {
    const home = await mkdtemp(join(tmpdir(), "notty-skill-"));
    try {
      const result = await installSkill({
        home,
        text: "# Notty skill\n",
        run: () => ({ status: null, error: new Error("missing") }),
      });

      const path = join(home, ".agents/skills/notty/SKILL.md");
      expect(result).toEqual({ method: "file", path });
      await expect(readFile(path, "utf8")).resolves.toBe("# Notty skill\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
