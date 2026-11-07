import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NottyClient, NottyNote } from "../modules/client";
import type { NoteSummary } from "../modules/note-index";
import { CliUsageError, parseArgv } from "./args";
import { runCli, type CliHooks } from "./run";
import { installSkill } from "./skill";
import { updateNotty } from "./update";

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
  listTrashNotes: vi.fn(async () => [summary()]),
  purgeNote: vi.fn(async () => undefined),
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

  it("parses update with --check and --json", () => {
    expect(parseArgv(["update"])).toEqual({ kind: "update", json: false });
    expect(parseArgv(["update", "--check", "--json"])).toEqual({
      kind: "update",
      json: true,
      checkOnly: true,
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
  it("points terminal users at the desktop binary in help", async () => {
    const help = hooks(fakeClient());
    expect(await runCli(["help"], help)).toBe(0);
    expect(help.out.join("")).toContain(
      "Desktop app: run 'notty-desktop' or launch Notty from your applications menu.",
    );
    expect(help.out.join("")).toContain("notty update [--check] [--json]");
  });

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

describe("runCli update", () => {
  it("does not open the vault", async () => {
    const openClient = vi.fn(async () => fakeClient());
    const command = hooks(fakeClient(), {
      openClient,
      updateApp: async () => ({
        current: "0.2.7",
        latest: "0.2.7",
        updated: false,
      }),
    });

    expect(await runCli(["update"], command)).toBe(0);
    expect(openClient).not.toHaveBeenCalled();
  });

  it("reports when Notty is already up to date", async () => {
    const upToDate = hooks(fakeClient(), {
      updateApp: async () => ({
        current: "0.2.7",
        latest: "0.2.7",
        updated: false,
      }),
    });

    expect(await runCli(["update"], upToDate)).toBe(0);
    expect(upToDate.out.join("")).toBe(
      "Notty is already up to date (v0.2.7).\n",
    );
    expect(upToDate.err).toEqual([]);
  });

  it("reports an installed update", async () => {
    const updated = hooks(fakeClient(), {
      updateApp: async () => ({
        current: "0.2.6",
        latest: "0.2.7",
        updated: true,
      }),
    });

    expect(await runCli(["update"], updated)).toBe(0);
    expect(updated.out.join("")).toBe(
      "Updating Notty from v0.2.6 to v0.2.7...\n" +
        "Updated Notty to v0.2.7!\n",
    );
  });

  it("prints structured status with --json", async () => {
    const structured = hooks(fakeClient(), {
      updateApp: async () => ({
        current: "0.2.6",
        latest: "0.2.7",
        updated: true,
      }),
    });

    expect(await runCli(["update", "--json"], structured)).toBe(0);
    expect(JSON.parse(structured.out.join(""))).toEqual({
      current: "0.2.6",
      latest: "0.2.7",
      updated: true,
    });
  });

  it("passes --check through and reports availability", async () => {
    const calls: Array<{ readonly checkOnly?: boolean }> = [];
    const check = hooks(fakeClient(), {
      updateApp: async (options) => {
        calls.push(options);
        return { current: "0.2.6", latest: "0.2.7", updated: false };
      },
    });

    expect(await runCli(["update", "--check"], check)).toBe(0);
    expect(calls).toEqual([{ checkOnly: true }]);
    expect(check.out.join("")).toBe(
      "Notty v0.2.7 is available (current v0.2.6).\n",
    );
  });

  it("exits 1 with a helpful message when the network fails", async () => {
    const offline = hooks(fakeClient(), {
      updateApp: async () => {
        throw new Error("Could not check for updates (offline)");
      },
    });

    expect(await runCli(["update"], offline)).toBe(1);
    expect(offline.err.join("")).toBe(
      "notty: Could not check for updates (offline)\n",
    );
    expect(offline.out).toEqual([]);
  });
});

describe("updateNotty", () => {
  it("does not install when the running version is current", async () => {
    const installRelease = vi.fn(async () => undefined);

    await expect(
      updateNotty({
        currentVersion: "0.2.7",
        fetchRelease: async () => ({ version: "v0.2.7", downloadUrl: null }),
        installRelease,
      }),
    ).resolves.toEqual({ current: "0.2.7", latest: "0.2.7", updated: false });
    expect(installRelease).not.toHaveBeenCalled();
  });

  it("installs a newer release unless --check is set", async () => {
    const installRelease = vi.fn(async () => undefined);
    const fetchRelease = async () => ({
      version: "0.2.7",
      downloadUrl: "https://example.test/notty.tar.gz",
    });

    await expect(
      updateNotty({
        currentVersion: "0.2.6",
        checkOnly: true,
        fetchRelease,
        installRelease,
      }),
    ).resolves.toEqual({ current: "0.2.6", latest: "0.2.7", updated: false });
    expect(installRelease).not.toHaveBeenCalled();

    await expect(
      updateNotty({ currentVersion: "0.2.6", fetchRelease, installRelease }),
    ).resolves.toEqual({ current: "0.2.6", latest: "0.2.7", updated: true });
    expect(installRelease).toHaveBeenCalledTimes(1);
  });

  it("never downgrades to an older release", async () => {
    const installRelease = vi.fn(async () => undefined);

    await expect(
      updateNotty({
        currentVersion: "0.2.8",
        fetchRelease: async () => ({
          version: "0.2.7",
          downloadUrl: "https://example.test/notty.tar.gz",
        }),
        installRelease,
      }),
    ).resolves.toEqual({ current: "0.2.8", latest: "0.2.7", updated: false });
    expect(installRelease).not.toHaveBeenCalled();
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
