/**
 * Private: the note-file format implementation.
 *
 * Pure and I/O-free. The public interface is re-exported from ./index — never
 * import this file from outside the module.
 *
 * A note file is YAML frontmatter followed by a Markdown body. This module
 * owns the file format only: it does not parse Markdown into a tree, so every
 * Markdown node the editor can produce survives a round-trip unchanged.
 */

/** A note as it lives in a Markdown file. */
export interface Note {
  /** Stable identity for the life of the note. */
  readonly id: string;
  /** Stored title. Never derived at read time. */
  readonly title: string;
  /** ISO 8601 UTC creation time. */
  readonly created: string;
  /** ISO 8601 UTC last-modified time. */
  readonly modified: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  /**
   * True once the user has edited the title. Auto-titling stops at that point.
   * Absent on notes whose title is still derived from the body.
   */
  readonly titleLocked?: boolean;
  /** Markdown body. An empty document is the empty string. */
  readonly body: string;
  /**
   * Frontmatter keys this build does not understand. They are written back
   * verbatim, so a newer build's fields survive an older build's save.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface AutoTitleOptions {
  /** Maximum number of body words to keep. Defaults to 6. */
  readonly maxWords?: number;
  /** Text between the date and the words. Defaults to an em dash. */
  readonly separator?: string;
}

const KNOWN_KEYS = [
  "id",
  "title",
  "created",
  "modified",
  "pinned",
  "archived",
  "titleLocked",
] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];

const isKnownKey = (key: string): key is KnownKey =>
  (KNOWN_KEYS as readonly string[]).includes(key);

interface RawEntry {
  readonly key: string;
  /** The complete source lines for this entry, including the key line. */
  readonly lines: readonly string[];
}

/**
 * Parsed entries keep their source order and raw text. That is what makes
 * unknown frontmatter byte-preserving without understanding its YAML shape.
 */
const RAW_ENTRIES = Symbol("notty.note-file.raw-entries");

type NoteWithRawEntries = Note & {
  readonly [RAW_ENTRIES]?: readonly RawEntry[];
};

/** Parse a note file's contents into a Note value. */
export const parse = (fileContents: string): Note => {
  const normalized = normalizeNewlines(fileContents).replace(/^\uFEFF/, "");
  const split = splitFrontmatter(normalized);
  const entries = split.hasFrontmatter ? parseEntries(split.frontmatter) : [];

  const values = new Map<string, unknown>();
  for (const entry of entries) {
    if (!values.has(entry.key)) values.set(entry.key, parseEntryValue(entry));
  }

  const extra: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!isKnownKey(entry.key) && !(entry.key in extra)) {
      extra[entry.key] = parseEntryValue(entry);
    }
  }

  const note: Note = {
    id: asString(values.get("id")),
    title: asString(values.get("title")),
    created: asString(values.get("created")),
    modified: asString(values.get("modified")),
    pinned: asBoolean(values.get("pinned")),
    archived: asBoolean(values.get("archived")),
    ...(asBoolean(values.get("titleLocked")) ? { titleLocked: true } : {}),
    body: split.body,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };

  Object.defineProperty(note, RAW_ENTRIES, {
    value: entries,
    enumerable: false,
  });
  return note;
};

/** Serialize a Note value back to note-file contents. */
export const serialize = (note: Note): string => {
  const values: Record<KnownKey, string> = {
    id: formatString(note.id),
    title: formatString(note.title),
    created: formatString(note.created),
    modified: formatString(note.modified),
    pinned: note.pinned ? "true" : "false",
    archived: note.archived ? "true" : "false",
    titleLocked: note.titleLocked === true ? "true" : "false",
  };

  const rawEntries = (note as NoteWithRawEntries)[RAW_ENTRIES] ?? [];
  const extra = note.extra ?? {};
  const seen = new Set<string>();
  const lines: string[] = [];

  // Keep the source order of parsed frontmatter, canonicalising only the
  // values this build owns. Unknown entries are copied line for line.
  for (const entry of rawEntries) {
    if (isKnownKey(entry.key)) {
      // `titleLocked` is only written while it is true; a false value is the
      // absent default for every note that has never had its title edited.
      if (entry.key === "titleLocked" && note.titleLocked !== true) {
        seen.add(entry.key);
        continue;
      }
      lines.push(`${entry.key}: ${values[entry.key]}`);
      seen.add(entry.key);
    } else if (hasOwn(extra, entry.key)) {
      lines.push(...entry.lines);
      seen.add(entry.key);
    }
  }

  for (const key of KNOWN_KEYS) {
    if (seen.has(key)) continue;
    if (key === "titleLocked" && note.titleLocked !== true) continue;
    lines.push(`${key}: ${values[key]}`);
    seen.add(key);
  }

  for (const [key, value] of Object.entries(extra)) {
    if (!seen.has(key)) {
      lines.push(...formatExtraEntry(key, value));
      seen.add(key);
    }
  }

  const header = `---\n${lines.join("\n")}\n---\n`;
  return note.body.length === 0 ? header : `${header}\n${note.body}`;
};

/** The public aliases read a little better at call sites that use "note". */
export const parseNote = parse;
export const serializeNote = serialize;

/**
 * Derive the title a new note shows until the user edits it:
 * the creation date plus the first words of the body.
 *
 * Accepts a Note (or anything with `created` and `body`), or the two values
 * separately. The workspace decides when to call this; parse never does.
 */
export const deriveAutoTitle = (
  createdOrNote: string | Date | Pick<Note, "created" | "body">,
  body?: string,
  options: AutoTitleOptions = {},
): string => {
  const created =
    typeof createdOrNote === "object" && !(createdOrNote instanceof Date)
      ? createdOrNote.created
      : createdOrNote;
  const sourceBody =
    typeof createdOrNote === "object" && !(createdOrNote instanceof Date)
      ? createdOrNote.body
      : (body ?? "");

  const date = formatDate(created);
  const words = firstWords(sourceBody, options.maxWords ?? 6);
  const separator = options.separator ?? " — ";

  if (date.length === 0) return words;
  if (words.length === 0) return date;
  return `${date}${separator}${words}`;
};

export const deriveTitle = deriveAutoTitle;
export const autoTitle = deriveAutoTitle;

/** The vault-relative directory that holds attachments. */
export const ATTACHMENTS_DIRECTORY = "attachments";

/**
 * Turn an attachment filename (or a path relative to the vault) into the
 * relative reference a note body should contain.
 */
export const attachmentReference = (filenameOrPath: string): string => {
  const normalized = filenameOrPath
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "");
  if (
    normalized === ATTACHMENTS_DIRECTORY ||
    normalized.startsWith(`${ATTACHMENTS_DIRECTORY}/`)
  ) {
    return normalized;
  }
  return `${ATTACHMENTS_DIRECTORY}/${normalized}`;
};

/** True when a reference is a relative path into the attachments directory. */
export const isAttachmentReference = (reference: string): boolean => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) return false;
  if (reference.startsWith("/") || reference.startsWith("~")) return false;
  const normalized = reference.replace(/\\/g, "/");
  return (
    normalized === ATTACHMENTS_DIRECTORY ||
    normalized.startsWith(`${ATTACHMENTS_DIRECTORY}/`)
  );
};

/** True for inline image payloads, which the file format forbids. */
export const isInlineImageData = (reference: string): boolean =>
  /^data:/i.test(reference.trim());

/** Extract the image references from a Markdown body, in source order. */
export const imageReferences = (body: string): string[] => {
  const references: string[] = [];
  const pattern = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (const match of body.matchAll(pattern)) {
    references.push(match[1]);
  }
  return references;
};

interface SplitFile {
  readonly hasFrontmatter: boolean;
  readonly frontmatter: string;
  readonly body: string;
}

const normalizeNewlines = (value: string): string =>
  value.replace(/\r\n?/g, "\n");

const splitFrontmatter = (value: string): SplitFile => {
  const lines = value.split("\n");
  if ((lines[0] ?? "").trimEnd() !== "---") {
    return { hasFrontmatter: false, frontmatter: "", body: value };
  }

  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (line === "---" || line === "...") {
      closing = index;
      break;
    }
  }

  if (closing === -1) {
    return { hasFrontmatter: false, frontmatter: "", body: value };
  }

  const bodyLines = lines.slice(closing + 1);
  // One blank line separates the header from the body. Keep any further
  // leading blank lines: they are part of the user's Markdown.
  if (bodyLines[0] === "") bodyLines.shift();

  return {
    hasFrontmatter: true,
    frontmatter: lines.slice(1, closing).join("\n"),
    body: bodyLines.join("\n"),
  };
};

const parseEntries = (frontmatter: string): RawEntry[] => {
  const entries: RawEntry[] = [];
  let current: { key: string; lines: string[] } | undefined;

  for (const line of frontmatter.split("\n")) {
    const isIndented = /^[\t ]/.test(line);
    const isBlank = line.trim().length === 0;
    const isComment = line.trimStart().startsWith("#");

    if (!isIndented && !isBlank && !isComment) {
      const colon = findKeyColon(line);
      if (colon > 0) {
        const key = parseKey(line.slice(0, colon).trim());
        current = { key, lines: [line] };
        entries.push(current);
        continue;
      }
    }

    if (current) current.lines.push(line);
  }

  return entries;
};

const findKeyColon = (line: string): number => {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") index += 1;
      else if (char === '"') quote = undefined;
    } else if (quote === "'") {
      if (char === "'") {
        if (line[index + 1] === "'") index += 1;
        else quote = undefined;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ":") {
      return index;
    }
  }
  return -1;
};

const parseKey = (raw: string): string => {
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to the unquoted form.
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
};

const parseEntryValue = (entry: RawEntry): unknown => {
  const colon = findKeyColon(entry.lines[0]);
  const first = entry.lines[0].slice(colon + 1).trim();
  const rest = entry.lines.slice(1);

  if (/^[|>][+-]?$/.test(first)) {
    return parseBlockScalar(first, rest);
  }

  if (first.length > 0) return parseScalar(first);

  const meaningful = rest.filter((line) => line.trim().length > 0);
  if (meaningful.length === 0) return null;

  if (meaningful.every((line) => /^\s*-(\s|$)/.test(line))) {
    return meaningful.map((line) => parseScalar(line.replace(/^\s*-\s?/, "")));
  }

  const object: Record<string, unknown> = {};
  for (const line of meaningful) {
    const entryColon = findKeyColon(line);
    if (entryColon < 0) continue;
    const key = parseKey(line.slice(0, entryColon).trim());
    object[key] = parseScalar(line.slice(entryColon + 1).trim());
  }
  return object;
};

const parseBlockScalar = (
  indicator: string,
  lines: readonly string[],
): string => {
  const nonBlank = lines.filter((line) => line.trim().length > 0);
  const indent = nonBlank.reduce((smallest, line) => {
    const size = line.length - line.trimStart().length;
    return Math.min(smallest, size);
  }, Number.POSITIVE_INFINITY);

  const body = lines
    .map((line) => (line.trim().length === 0 ? "" : line.slice(indent)))
    .join("\n");

  if (indicator.startsWith(">")) {
    return body.replace(/\n+/g, " ").trim();
  }
  return indicator.includes("-") ? body.replace(/\n+$/, "") : body;
};

const parseScalar = (raw: string): unknown => {
  let value = raw.trim();
  if (value.length === 0) return null;

  if (value.startsWith('"')) {
    const end = findClosingDoubleQuote(value);
    const token = end >= 0 ? value.slice(0, end + 1) : value;
    try {
      return JSON.parse(token);
    } catch {
      return token.slice(1, -1);
    }
  }

  if (value.startsWith("'")) {
    const end = findClosingSingleQuote(value);
    const token = end >= 0 ? value.slice(0, end + 1) : value;
    return token.slice(1, -1).replace(/''/g, "'");
  }

  value = stripInlineComment(value);
  if (value === "" || value === "~" || /^null$/i.test(value)) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
};

const findClosingDoubleQuote = (value: string): number => {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "\\") index += 1;
    else if (value[index] === '"') return index;
  }
  return -1;
};

const findClosingSingleQuote = (value: string): number => {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "'") {
      if (value[index + 1] === "'") index += 1;
      else return index;
    }
  }
  return -1;
};

const stripInlineComment = (value: string): string => {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
};

const asString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

const asBoolean = (value: unknown): boolean =>
  value === true || (typeof value === "string" && /^true$/i.test(value));

const formatString = (value: string): string =>
  isSafePlainScalar(value) ? value : JSON.stringify(value);

const isSafePlainScalar = (value: string): boolean => {
  if (value.length === 0) return false;
  if (/^\s|\s$/.test(value)) return false;
  if (/[\n\r\t]/.test(value)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
  if (/:\s/.test(value) || /:$/.test(value) || /(^|\s)#/.test(value)) {
    return false;
  }
  if (/^(?:true|false|null|~|yes|no|on|off)$/i.test(value)) return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return false;
  }
  return true;
};

const formatKey = (key: string): string =>
  /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);

const formatExtraEntry = (key: string, value: unknown): string[] => {
  const name = formatKey(key);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${name}: []`];
    const lines = [`${name}:`];
    for (const item of value) {
      lines.push(...formatListItem(item, 2));
    }
    return lines;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${name}: {}`];
    const lines = [`${name}:`];
    for (const childKey of keys) {
      const child = value[childKey];
      const childLines = formatExtraEntry(childKey, child);
      lines.push(...childLines.map((line) => `  ${line}`));
    }
    return lines;
  }

  return [`${name}: ${formatUnknownScalar(value)}`];
};

const formatListItem = (value: unknown, indent: number): string[] => {
  const padding = " ".repeat(indent);
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${padding}- {}`];
    const lines = [`${padding}-`];
    for (const key of keys) {
      const childLines = formatExtraEntry(key, value[key]);
      lines.push(...childLines.map((line) => `${padding}  ${line}`));
    }
    return lines;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${padding}- []`];
    const lines = [`${padding}-`];
    for (const item of value) {
      lines.push(...formatListItem(item, indent + 2));
    }
    return lines;
  }
  return [`${padding}- ${formatUnknownScalar(value)}`];
};

const formatUnknownScalar = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return formatString(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return formatString(value.toISOString());
  return formatString(String(value));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

const formatDate = (value: string | Date): string => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString().slice(0, 10);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : value.trim();
};

const firstWords = (body: string, maxWords: number): string => {
  if (maxWords <= 0) return "";
  const words: string[] = [];
  let index = 0;

  // Scan rather than split: auto-title runs on every keystroke, including on
  // very long notes, so the work must stay proportional to the words kept.
  while (index < body.length && words.length < maxWords) {
    while (index < body.length && /\s/.test(body[index])) index += 1;
    if (index >= body.length) break;
    const start = index;
    while (index < body.length && !/\s/.test(body[index])) index += 1;
    words.push(body.slice(start, index));
  }

  return words.join(" ");
};
