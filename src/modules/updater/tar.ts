/**
 * Private: the smallest tar reader the updater needs.
 *
 * Release tarballs are built with GNU tar, which may emit long-name and pax
 * headers. Only regular files and directories matter here; links and device
 * entries are ignored so a crafted archive cannot escape the staging
 * directory.
 */

export type TarEntryKind = "file" | "directory";

export interface TarEntry {
  readonly name: string;
  readonly kind: TarEntryKind;
  readonly bytes: Uint8Array | null;
}

const decoder = new TextDecoder();

const readString = (
  archive: Uint8Array,
  start: number,
  length: number,
): string => {
  const slice = archive.subarray(start, start + length);
  const end = slice.indexOf(0);
  return decoder.decode(end < 0 ? slice : slice.subarray(0, end));
};

const readSize = (archive: Uint8Array, offset: number): number => {
  const raw = readString(archive, offset, 12).trim();
  if (raw.length === 0) return 0;
  const size = Number.parseInt(raw, 8);
  return Number.isFinite(size) && size > 0 ? size : 0;
};

const padded = (size: number): number => Math.ceil(size / 512) * 512;

const blockIsEmpty = (archive: Uint8Array, offset: number): boolean => {
  for (let index = offset; index < offset + 512; index += 1) {
    if (archive[index] !== 0) return false;
  }
  return true;
};

const parsePaxPath = (data: Uint8Array): string | null => {
  const text = decoder.decode(data);
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ");
    if (space <= 0) continue;
    const record = line.slice(space + 1);
    if (record.startsWith("path=")) return record.slice("path=".length);
  }
  return null;
};

export const parseTar = (archive: Uint8Array): ReadonlyArray<TarEntry> => {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxName: string | null = null;

  while (offset + 512 <= archive.length) {
    if (blockIsEmpty(archive, offset)) break;

    const header = archive;
    const type = String.fromCharCode(header[offset + 156] ?? 0);
    const size = readSize(archive, offset + 124);
    const dataStart = offset + 512;
    const dataEnd = Math.min(dataStart + size, archive.length);

    if (type === "L") {
      longName = readString(archive, dataStart, size).replace(/\0+$/, "");
      offset = dataStart + padded(size);
      continue;
    }

    if (type === "x") {
      paxName = parsePaxPath(archive.subarray(dataStart, dataEnd));
      offset = dataStart + padded(size);
      continue;
    }

    if (type === "g") {
      offset = dataStart + padded(size);
      continue;
    }

    const prefix = readString(archive, offset + 345, 155);
    const shortName = readString(archive, offset, 100);
    const name =
      paxName ?? longName ?? (prefix.length > 0 ? `${prefix}/${shortName}` : shortName);

    if (type === "0" || type === "\0" || type === "7") {
      entries.push({
        name,
        kind: "file",
        bytes: archive.subarray(dataStart, dataEnd),
      });
    } else if (type === "5") {
      entries.push({ name, kind: "directory", bytes: null });
    }
    // Symbolic links, hard links and device nodes are intentionally skipped.

    longName = null;
    paxName = null;
    offset = dataStart + padded(size);
  }

  return entries;
};

/**
 * Strip the single wrapping directory GitHub releases use. Entries that try
 * to climb out of the staging root are rejected rather than normalised.
 */
export const stripReleaseRoot = (
  entries: ReadonlyArray<TarEntry>,
): ReadonlyArray<TarEntry> => {
  const clean = (name: string): string | null => {
    const segments = name
      .replace(/^\.\//, "")
      .split("/")
      .filter((segment) => segment.length > 0 && segment !== ".");
    if (segments.some((segment) => segment === "..")) return null;
    return segments.join("/");
  };

  const cleaned = entries
    .map((entry) => ({ ...entry, name: clean(entry.name) }))
    .filter(
      (entry): entry is TarEntry & { readonly name: string } =>
        entry.name !== null && entry.name.length > 0,
    );

  const roots = new Set(
    cleaned.map((entry) => entry.name.split("/")[0]).filter(Boolean),
  );
  const strip =
    roots.size === 1 &&
    cleaned.some((entry) => entry.name.includes("/"));
  if (!strip) return cleaned;

  return cleaned
    .map((entry) => {
      const slash = entry.name.indexOf("/");
      return slash < 0 ? null : { ...entry, name: entry.name.slice(slash + 1) };
    })
    .filter(
      (entry): entry is TarEntry =>
        entry !== null && entry.name.length > 0,
    );
};
