/**
 * The CLI adapter: parse arguments, dispatch to NottyClient, write stdout.
 *
 * Everything process-shaped is injected, so tests can run commands against an
 * in-memory client and inspect exact output and exit codes.
 */
import type { NottyClient, NottyNote } from "../modules/client";
import type { NoteSummary } from "../modules/note-index";
import {
  CliUsageError,
  HELP_TEXT,
  parseArgv,
  type CliCommand,
} from "./args";
import {
  json as toJson,
  noteJson,
  noteMarkdown,
  summaryJson,
  summaryLine,
  summaryLines,
} from "./format";
import { installSkill, SKILL_TEXT, type SkillInstallResult } from "./skill";
import { updateNotty, type UpdateResult } from "./update";

export interface CliHooks {
  readonly openClient: () => Promise<NottyClient>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly version: string;
  readonly skillText?: string;
  readonly installSkill?: () => Promise<SkillInstallResult>;
  readonly updateApp?: (options: {
    readonly checkOnly?: boolean;
  }) => Promise<UpdateResult>;
}

const withFolder = (entry: NottyNote): NoteSummary => ({
  ...entry.note,
  folder: entry.folder,
});

const emitNote = (
  hooks: CliHooks,
  asJson: boolean,
  entry: NottyNote,
): void => {
  hooks.stdout(
    asJson ? toJson(noteJson(entry)) : `${summaryLine(withFolder(entry))}\n`,
  );
};

const runCommand = async (
  command: CliCommand,
  client: NottyClient,
  hooks: CliHooks,
): Promise<void> => {
  switch (command.kind) {
    case "list": {
      const notes = await client.listNotes({
        ...(command.folder === undefined ? {} : { folder: command.folder }),
        ...(command.pinned === undefined ? {} : { pinned: command.pinned }),
        ...(command.archived === undefined
          ? { includeArchived: command.includeArchived === true }
          : { archived: command.archived }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      });
      hooks.stdout(
        command.json ? toJson(notes.map(summaryJson)) : summaryLines(notes),
      );
      return;
    }

    case "search": {
      const notes = await client.searchNotes(command.query, {
        ...(command.folder === undefined ? {} : { folder: command.folder }),
        ...(command.includeArchived === true
          ? { includeArchived: true }
          : {}),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      });
      hooks.stdout(
        command.json ? toJson(notes.map(summaryJson)) : summaryLines(notes),
      );
      return;
    }

    case "read": {
      const entry = await client.readNote(command.id);
      if (entry === null) {
        throw new Error(`Note not found: ${command.id}`);
      }
      hooks.stdout(
        command.json ? toJson(noteJson(entry)) : noteMarkdown(entry),
      );
      return;
    }

    case "create": {
      const entry = await client.createNote({
        ...(command.folder === undefined ? {} : { folder: command.folder }),
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.body === undefined ? {} : { body: command.body }),
      });
      emitNote(hooks, command.json, entry);
      return;
    }

    case "append": {
      const entry = await client.appendToNote(command.id, command.text);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "edit": {
      const entry =
        command.body !== undefined
          ? await client.replaceNoteBody(command.id, command.body)
          : await client.editNote(command.id, {
              target: command.target as string,
              replacement: command.replacement as string,
            });
      emitNote(hooks, command.json, entry);
      return;
    }

    case "rename": {
      const entry = await client.renameNote(command.id, command.title);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "move": {
      const entry = await client.moveNote(command.id, command.folder);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "pin": {
      const entry = await client.pinNote(command.id, command.pinned);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "archive": {
      const entry = await client.archiveNote(command.id, command.archived);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "duplicate": {
      const entry = await client.duplicateNote(command.id);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "trash": {
      await client.trashNote(command.id);
      hooks.stdout(
        command.json
          ? toJson({ id: command.id, trashed: true })
          : `Trashed ${command.id}\n`,
      );
      return;
    }

    case "restore": {
      const entry = await client.restoreNote(command.id);
      emitNote(hooks, command.json, entry);
      return;
    }

    case "folders": {
      const folders = await client.listFolders();
      hooks.stdout(
        command.json
          ? toJson(folders)
          : folders.map((folder) => `${folder}\n`).join(""),
      );
      return;
    }

    case "folder-create": {
      const folder = await client.createFolder(command.folder);
      hooks.stdout(command.json ? toJson({ folder }) : `${folder}\n`);
      return;
    }

    case "folder-rename": {
      const folder = await client.renameFolder(
        command.folder,
        command.nextFolder,
      );
      hooks.stdout(command.json ? toJson({ folder }) : `${folder}\n`);
      return;
    }

    case "folder-delete": {
      await client.deleteFolder(command.folder);
      hooks.stdout(
        command.json
          ? toJson({ folder: command.folder, deleted: true })
          : `Deleted folder ${command.folder}\n`,
      );
      return;
    }

    default:
      return;
  }
};

const runSkillCommand = async (
  command: CliCommand,
  hooks: CliHooks,
): Promise<void> => {
  if (command.kind === "skill-print") {
    const text = hooks.skillText ?? SKILL_TEXT;
    hooks.stdout(text.endsWith("\n") ? text : `${text}\n`);
    return;
  }

  if (command.kind === "skill-install") {
    const result = await (hooks.installSkill ?? (() => installSkill()))();
    if (command.json) {
      hooks.stdout(
        toJson({
          installed: true,
          method: result.method,
          ...(result.path === undefined ? {} : { path: result.path }),
        }),
      );
      return;
    }
    hooks.stdout(
      result.method === "skills"
        ? "Installed the Notty skill with the skills CLI.\n"
        : `Installed the Notty skill at ${result.path}\n`,
    );
  }
};

const runUpdateCommand = async (
  command: Extract<CliCommand, { readonly kind: "update" }>,
  hooks: CliHooks,
): Promise<void> => {
  const update =
    hooks.updateApp ??
    ((options: { readonly checkOnly?: boolean }) =>
      updateNotty({ currentVersion: hooks.version, ...options }));

  const result = await update(
    command.checkOnly === true ? { checkOnly: true } : {},
  );

  if (command.json) {
    hooks.stdout(
      toJson({
        current: result.current,
        latest: result.latest,
        updated: result.updated,
      }),
    );
    return;
  }

  if (result.updated) {
    hooks.stdout(
      `Updating Notty from v${result.current} to v${result.latest}...\n` +
        `Updated Notty to v${result.latest}!\n`,
    );
    return;
  }

  if (result.latest === result.current) {
    hooks.stdout(`Notty is already up to date (v${result.current}).\n`);
    return;
  }

  hooks.stdout(
    `Notty v${result.latest} is available (current v${result.current}).\n`,
  );
};

/** Run one command. Returns the process exit code. */
export const runCli = async (
  argv: ReadonlyArray<string>,
  hooks: CliHooks,
): Promise<number> => {
  let command: CliCommand;
  try {
    command = parseArgv(argv);
  } catch (cause) {
    if (cause instanceof CliUsageError) {
      hooks.stderr(
        `notty: ${cause.message}\n\nRun 'notty --help' for usage.\n`,
      );
      return 2;
    }
    hooks.stderr(`notty: ${messageOf(cause)}\n`);
    return 1;
  }

  if (command.kind === "help") {
    hooks.stdout(HELP_TEXT);
    return 0;
  }
  if (command.kind === "version") {
    hooks.stdout(`notty ${hooks.version}\n`);
    return 0;
  }

  if (command.kind === "update") {
    try {
      await runUpdateCommand(command, hooks);
      return 0;
    } catch (cause) {
      hooks.stderr(`notty: ${messageOf(cause)}\n`);
      return 1;
    }
  }

  if (command.kind === "skill-print" || command.kind === "skill-install") {
    try {
      await runSkillCommand(command, hooks);
      return 0;
    } catch (cause) {
      hooks.stderr(`notty: ${messageOf(cause)}\n`);
      return 1;
    }
  }

  let client: NottyClient | null = null;
  try {
    client = await hooks.openClient();
    await runCommand(command, client, hooks);
    return 0;
  } catch (cause) {
    hooks.stderr(`notty: ${messageOf(cause)}\n`);
    return 1;
  } finally {
    if (client !== null) {
      try {
        await client.dispose();
      } catch {
        // Disposal failures must not mask the command's own outcome.
      }
    }
  }
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
