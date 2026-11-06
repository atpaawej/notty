/**
 * Private: version comparison.
 *
 * GitHub tags may carry a leading `v`; prereleases sort below the matching
 * stable release. This is deliberately small — Notty only needs to answer
 * "is the published version newer than the running one?".
 */

export interface ParsedVersion {
  readonly numbers: ReadonlyArray<number>;
  readonly prerelease: ReadonlyArray<string> | null;
}

export const parseVersion = (input: string): ParsedVersion => {
  const withoutPrefix = input.trim().replace(/^[vV]/, "").split("+")[0];
  const dash = withoutPrefix.indexOf("-");
  const core = dash < 0 ? withoutPrefix : withoutPrefix.slice(0, dash);
  const prerelease =
    dash < 0
      ? null
      : withoutPrefix
          .slice(dash + 1)
          .split(".")
          .filter((part) => part.length > 0);

  return {
    numbers: core.split(".").map((part) => {
      const number = Number.parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    }),
    prerelease:
      prerelease === null || prerelease.length === 0 ? null : prerelease,
  };
};

const compareNumbers = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): number => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
};

const isNumeric = (value: string): boolean => /^\d+$/.test(value);

const comparePrerelease = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = isNumeric(a);
    const bNumeric = isNumeric(b);
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
};

/**
 * Compare two version strings. Returns a negative number when `left` is
 * older than `right`, zero when they match, and a positive number when it is
 * newer. Accepts `v` prefixes, build metadata and prerelease suffixes.
 */
export const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const core = compareNumbers(a.numbers, b.numbers);
  if (core !== 0) return core;

  // A stable release is newer than any prerelease of the same core version.
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
};

/** True when `latest` is strictly newer than `current`. */
export const isNewerVersion = (latest: string, current: string): boolean =>
  compareVersions(latest, current) > 0;

/** Readable aliases used by callers and tests. */
export const isVersionNewer = isNewerVersion;
export const newerVersion = isNewerVersion;
export const isNewer = isNewerVersion;
export const compareSemver = compareVersions;
