/**
 * Command-line parsing. Pure: no process, filesystem or Notty access.
 */

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type CliCommand =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "list";
      readonly json: boolean;
      readonly folder?: string;
      readonly pinned?: boolean;
      readonly archived?: boolean;
      readonly includeArchived?: boolean;
      readonly limit?: number;
    }
  | {
      readonly kind: "search";
      readonly json: boolean;
      readonly query: string;
      readonly folder?: string;
      readonly includeArchived?: boolean;
      readonly limit?: number;
    }
  | { readonly kind: "read"; readonly json: boolean; readonly id: string }
  | {
      readonly kind: "create";
      readonly json: boolean;
      readonly folder?: string;
      readonly title?: string;
      readonly body?: string;
    }
  | {
      readonly kind: "append";
      readonly json: boolean;
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "edit";
      readonly json: boolean;
      readonly id: string;
      readonly target?: string;
      readonly replacement?: string;
      readonly body?: string;
    }
  | {
      readonly kind: "rename";
      readonly json: boolean;
      readonly id: string;
      readonly title: string;
    }
  | {
      readonly kind: "move";
      readonly json: boolean;
      readonly id: string;
      readonly folder: string;
    }
  | {
      readonly kind: "pin";
      readonly json: boolean;
      readonly id: string;
      readonly pinned: boolean;
    }
  | {
      readonly kind: "archive";
      readonly json: boolean;
      readonly id: string;
      readonly archived: boolean;
    }
  | { readonly kind: "duplicate"; readonly json: boolean; readonly id: string }
  | { readonly kind: "trash"; readonly json: boolean; readonly id: string }
  | { readonly kind: "restore"; readonly json: boolean; readonly id: string }
  | { readonly kind: "folders"; readonly json: boolean }
  | {
      readonly kind: "folder-create";
      readonly json: boolean;
      readonly folder: string;
    }
  | {
      readonly kind: "folder-rename";
      readonly json: boolean;
      readonly folder: string;
      readonly nextFolder: string;
    }
  | {
      readonly kind: "folder-delete";
      readonly json: boolean;
      readonly folder: string;
    }
  | {
      readonly kind: "update";
      readonly json: boolean;
      readonly checkOnly?: boolean;
    }
  | { readonly kind: "skill-print" }
  | { readonly kind: "skill-install"; readonly json: boolean };

const VALUE_FLAGS = new Set([
  "--folder",
  "--title",
  "--body",
  "--text",
  "--target",
  "--replacement",
  "--limit",
  "--id",
]);

const BOOLEAN_FLAGS = new Set([
  "--json",
  "--pinned",
  "--archived",
  "--all",
  "--check",
  "--help",
  "--version",
]);

interface ParsedTokens {
  readonly positionals: ReadonlyArray<string>;
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

const tokenize = (argv: ReadonlyArray<string>): ParsedTokens => {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const equals = token.indexOf("=");
    const name = equals < 0 ? token : token.slice(0, equals);
    const inline = equals < 0 ? undefined : token.slice(equals + 1);

    if (BOOLEAN_FLAGS.has(name)) {
      if (inline !== undefined) {
        throw new CliUsageError(`${name} does not take a value`);
      }
      flags.add(name);
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[index + 1];
      if (value === undefined) {
        throw new CliUsageError(`${name} needs a value`);
      }
      if (inline === undefined) index += 1;
      values.set(name, value);
      continue;
    }

    throw new CliUsageError(`Unknown option: ${name}`);
  }

  return { positionals, values, flags };
};

const idOf = (tokens: ParsedTokens, index: number): string => {
  const id = tokens.values.get("--id") ?? tokens.positionals[index];
  if (id === undefined || id.length === 0) {
    throw new CliUsageError("A note id is required");
  }
  return id;
};

const folderOf = (
  tokens: ParsedTokens,
  position: number,
  label: string,
): string => {
  const folder = tokens.values.get("--folder") ?? tokens.positionals[position];
  if (folder === undefined) {
    throw new CliUsageError(`A ${label} is required`);
  }
  return folder;
};

const parseLimit = (tokens: ParsedTokens): number | undefined => {
  const raw = tokens.values.get("--limit");
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new CliUsageError("--limit must be a non-negative integer");
  }
  return value;
};

const optionalText = (
  values: ReadonlyArray<string | undefined>,
): string | undefined => values.find((value) => value !== undefined);

/** Parse argv into a command, or throw `CliUsageError`. */
export const parseArgv = (argv: ReadonlyArray<string>): CliCommand => {
  const tokens = tokenize(argv);
  const json = tokens.flags.has("--json");

  if (tokens.flags.has("--help")) return { kind: "help" };
  if (tokens.flags.has("--version")) return { kind: "version" };

  const name = tokens.positionals[0];
  if (name === undefined) return { kind: "help" };

  switch (name) {
    case "help":
      return { kind: "help" };

    case "list":
    case "ls": {
      const limit = parseLimit(tokens);
      return {
        kind: "list",
        json,
        ...(tokens.values.has("--folder")
          ? { folder: tokens.values.get("--folder") as string }
          : {}),
        ...(tokens.flags.has("--pinned") ? { pinned: true } : {}),
        ...(tokens.flags.has("--archived") ? { archived: true } : {}),
        ...(tokens.flags.has("--all") ? { includeArchived: true } : {}),
        ...(limit === undefined ? {} : { limit }),
      };
    }

    case "search":
    case "find": {
      const query = tokens.positionals.slice(1).join(" ").trim();
      if (query.length === 0) {
        throw new CliUsageError("A search query is required");
      }
      const limit = parseLimit(tokens);
      return {
        kind: "search",
        json,
        query,
        ...(tokens.values.has("--folder")
          ? { folder: tokens.values.get("--folder") as string }
          : {}),
        ...(tokens.flags.has("--all") || tokens.flags.has("--archived")
          ? { includeArchived: true }
          : {}),
        ...(limit === undefined ? {} : { limit }),
      };
    }

    case "read":
    case "show":
    case "cat":
      return { kind: "read", json, id: idOf(tokens, 1) };

    case "create":
    case "new": {
      const positionalBody = tokens.positionals.slice(1).join(" ").trim();
      const body = optionalText([
        tokens.values.get("--body"),
        positionalBody.length > 0 ? positionalBody : undefined,
      ]);
      return {
        kind: "create",
        json,
        ...(tokens.values.has("--folder")
          ? { folder: tokens.values.get("--folder") as string }
          : {}),
        ...(tokens.values.has("--title")
          ? { title: tokens.values.get("--title") as string }
          : {}),
        ...(body === undefined ? {} : { body }),
      };
    }

    case "append": {
      const positionalText = tokens.positionals.slice(2).join(" ").trim();
      const text = optionalText([
        tokens.values.get("--text"),
        positionalText.length > 0 ? positionalText : undefined,
      ]);
      if (text === undefined) {
        throw new CliUsageError("Text to append is required");
      }
      return { kind: "append", json, id: idOf(tokens, 1), text };
    }

    case "edit": {
      const target = tokens.values.get("--target");
      const replacement = tokens.values.get("--replacement");
      const body = tokens.values.get("--body");
      if (body === undefined) {
        if (target === undefined) {
          throw new CliUsageError(
            "--target and --replacement are required (or use --body)",
          );
        }
        if (replacement === undefined) {
          throw new CliUsageError("--replacement is required with --target");
        }
      }
      return {
        kind: "edit",
        json,
        id: idOf(tokens, 1),
        ...(target === undefined ? {} : { target }),
        ...(replacement === undefined ? {} : { replacement }),
        ...(body === undefined ? {} : { body }),
      };
    }

    case "rename": {
      const positionalTitle = tokens.positionals.slice(2).join(" ").trim();
      const title = optionalText([
        tokens.values.get("--title"),
        positionalTitle.length > 0 ? positionalTitle : undefined,
      ]);
      if (title === undefined) {
        throw new CliUsageError("A new title is required");
      }
      return { kind: "rename", json, id: idOf(tokens, 1), title };
    }

    case "move":
      return {
        kind: "move",
        json,
        id: idOf(tokens, 1),
        folder: folderOf(tokens, 2, "destination folder"),
      };

    case "pin":
      return { kind: "pin", json, id: idOf(tokens, 1), pinned: true };

    case "unpin":
      return { kind: "pin", json, id: idOf(tokens, 1), pinned: false };

    case "archive":
      return { kind: "archive", json, id: idOf(tokens, 1), archived: true };

    case "unarchive":
      return { kind: "archive", json, id: idOf(tokens, 1), archived: false };

    case "duplicate":
    case "dup":
      return { kind: "duplicate", json, id: idOf(tokens, 1) };

    case "delete":
    case "trash":
    case "rm":
      return { kind: "trash", json, id: idOf(tokens, 1) };

    case "restore":
    case "untrash":
      return { kind: "restore", json, id: idOf(tokens, 1) };

    case "folders":
      return { kind: "folders", json };

    case "folder": {
      const action = tokens.positionals[1];
      switch (action) {
        case undefined:
        case "list":
        case "ls":
          return { kind: "folders", json };
        case "create":
        case "add":
          return {
            kind: "folder-create",
            json,
            folder: folderOf(tokens, 2, "folder name"),
          };
        case "rename":
        case "mv": {
          const folder = tokens.positionals[2];
          const nextFolder = tokens.positionals[3];
          if (folder === undefined || nextFolder === undefined) {
            throw new CliUsageError("Folder rename needs an old and new name");
          }
          return { kind: "folder-rename", json, folder, nextFolder };
        }
        case "delete":
        case "remove":
        case "rm":
          return {
            kind: "folder-delete",
            json,
            folder: folderOf(tokens, 2, "folder name"),
          };
        default:
          throw new CliUsageError(`Unknown folder action: ${action}`);
      }
    }

    case "skill": {
      const action = tokens.positionals[1];
      if (action === "print") return { kind: "skill-print" };
      if (action === "install") return { kind: "skill-install", json };
      throw new CliUsageError("skill needs `print` or `install`");
    }

    case "update":
      return {
        kind: "update",
        json,
        ...(tokens.flags.has("--check") ? { checkOnly: true } : {}),
      };

    default:
      throw new CliUsageError(`Unknown command: ${name}`);
  }
};

export const HELP_TEXT = `notty — read and write your Notty notes from the terminal

Usage:
  notty list [--folder <path>] [--pinned] [--archived] [--all] [--limit <n>] [--json]
  notty search <query> [--folder <path>] [--all] [--limit <n>] [--json]
  notty read <id> [--json]

  notty create [--title <title>] [--body <markdown>] [--folder <path>] [--json]
  notty append <id> <text> [--json]
  notty edit <id> --target <text> --replacement <text> [--json]
  notty edit <id> --body <markdown> [--json]
  notty rename <id> <title> [--json]
  notty move <id> <folder> [--json]
  notty pin <id> | notty unpin <id>
  notty archive <id> | notty unarchive <id>
  notty duplicate <id>
  notty delete <id> | notty trash <id>
  notty restore <id>

  notty folders [--json]
  notty folder create <folder>
  notty folder rename <old> <new>
  notty folder delete <folder>

  notty update [--check] [--json]

  notty skill install [--json]
  notty skill print

Options:
  --json       Print machine-readable JSON instead of plain text.
  --check      Only report whether a newer release exists.
  --help       Show this help.
  --version    Show the CLI version.

Desktop app: run 'notty-desktop' or launch Notty from your applications menu.
`;
