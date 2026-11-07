/**
 * `notty update` — check GitHub Releases and replace the user-space install.
 *
 * The process-shaped pieces are injectable so `runCli` stays pure and the
 * command can be tested with in-memory adapters. The production adapter reads
 * the same layout the installer creates: the app under `$XDG_DATA_HOME/notty`
 * and the CLI link under `$XDG_BIN_HOME/notty`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const UPDATE_REPOSITORY = "atpaawej/notty";

/** The only network endpoint the command reads. */
export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;

/** What `notty update` reports, whether or not it installed anything. */
export interface UpdateResult {
  /** Version without the leading `v`, e.g. `0.2.7`. */
  readonly current: string;
  /** The newest published version without the leading `v`. */
  readonly latest: string;
  /** True only when this run replaced the installation. */
  readonly updated: boolean;
}

/** The newest release, reduced to what the command needs. */
export interface LatestRelease {
  readonly version: string;
  /** The Linux tarball for this machine, when one was published. */
  readonly downloadUrl: string | null;
}

export interface UpdateOptions {
  /** The version of the running CLI, normally `package.json`'s version. */
  readonly currentVersion: string;
  /** Report the newer version without installing it. */
  readonly checkOnly?: boolean;
  /** Test seam: the newest release. Defaults to GitHub Releases. */
  readonly fetchRelease?: () => Promise<LatestRelease>;
  /** Test seam: replace the installation. Defaults to user-space files. */
  readonly installRelease?: (release: LatestRelease) => Promise<void>;
  /** Test seam: where the app lives. Defaults to the XDG user-space path. */
  readonly installDir?: string;
  /** Test seam: where the CLI link lives. Defaults to the XDG bin path. */
  readonly binDir?: string;
}

interface GitHubAsset {
  readonly name?: unknown;
  readonly browser_download_url?: unknown;
}

interface GitHubRelease {
  readonly tag_name?: unknown;
  readonly assets?: ReadonlyArray<GitHubAsset>;
}

const LINUX_ASSET = /^notty-.*-linux-(x86_64|aarch64)\.tar\.gz$/;

const assetArch = (): string | null => {
  switch (process.arch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
    default:
      return null;
  }
};

const pickAsset = (
  assets: ReadonlyArray<GitHubAsset> | undefined,
): string | null => {
  const arch = assetArch();
  if (arch === null) return null;
  const match = (assets ?? []).find(
    (asset) =>
      typeof asset.name === "string" &&
      typeof asset.browser_download_url === "string" &&
      LINUX_ASSET.test(asset.name) &&
      asset.name.includes(arch),
  );
  return typeof match?.browser_download_url === "string"
    ? match.browser_download_url
    : null;
};

const normalize = (version: string): string =>
  version.trim().replace(/^[vV]/, "");

/**
 * Compare two release versions. The CLI keeps this dependency-free copy so a
 * `notty update` bundle never pulls the desktop updater's Tauri and React
 * adapters in behind it. The rules match the updater module: a `v` prefix and
 * build metadata are ignored, stable releases sort above prereleases.
 */
const compareVersions = (left: string, right: string): number => {
  const parse = (
    input: string,
  ): {
    readonly numbers: ReadonlyArray<number>;
    readonly prerelease: ReadonlyArray<string> | null;
  } => {
    const withoutPrefix = normalize(input).split("+")[0] ?? "";
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

  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.numbers[index] ?? 0;
    const y = b.numbers[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }

  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;

  const prereleaseLength = Math.max(
    a.prerelease.length,
    b.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
};

/** Read the newest release from GitHub. */
export const fetchLatestRelease = async (): Promise<LatestRelease> => {
  let response: Response;
  try {
    response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
  } catch {
    throw new Error("Could not check for updates (offline)");
  }

  if (!response.ok) {
    throw new Error(
      `Could not check for updates (GitHub returned ${response.status})`,
    );
  }

  let payload: GitHubRelease;
  try {
    payload = (await response.json()) as GitHubRelease;
  } catch {
    throw new Error("Could not check for updates (invalid release feed)");
  }

  if (typeof payload.tag_name !== "string") {
    throw new Error("Could not check for updates (no release tag)");
  }

  return {
    version: normalize(payload.tag_name),
    downloadUrl: pickAsset(payload.assets),
  };
};

const download = async (
  downloadUrl: string,
  destination: string,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(downloadUrl);
  } catch {
    throw new Error("Could not download the Notty update (offline)");
  }
  if (!response.ok) {
    throw new Error(
      `Could not download the Notty update (GitHub returned ${response.status})`,
    );
  }
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
};

const unpack = async (archive: string, destination: string): Promise<void> => {
  const result = spawnSync("tar", ["-xzf", archive, "-C", destination], {
    stdio: "ignore",
  });
  if (result.error !== undefined) {
    throw new Error("Could not unpack the Notty update (install tar first)");
  }
  if (result.status !== 0) {
    throw new Error("The downloaded Notty archive could not be unpacked");
  }
};

const pathsFor = (
  installDir: string | undefined,
  binDir: string | undefined,
): { readonly installDir: string; readonly binDir: string } => {
  const home = process.env.HOME ?? homedir();
  const dataRoot = process.env.XDG_DATA_HOME ?? join(home, ".local/share");
  const binRoot = process.env.XDG_BIN_HOME ?? join(home, ".local/bin");
  return {
    installDir:
      installDir ?? process.env.NOTTY_INSTALL_DIR ?? join(dataRoot, "notty"),
    binDir: binDir ?? binRoot,
  };
};

/**
 * Download the release tarball and copy it over the user-space installation,
 * then repoint the CLI link. The installer uses the same layout, so a later
 * update needs no elevation.
 */
export const installLatestRelease = async (
  release: LatestRelease,
  options: Pick<UpdateOptions, "installDir" | "binDir"> = {},
): Promise<void> => {
  if (release.downloadUrl === null) {
    throw new Error(
      "The latest release has no Linux package for this architecture",
    );
  }

  const { installDir, binDir } = pathsFor(options.installDir, options.binDir);
  const work = await mkdtemp(join(tmpdir(), "notty-update-"));
  try {
    const archive = join(work, "notty.tar.gz");
    const unpacked = join(work, "unpack");
    await mkdir(unpacked, { recursive: true });
    await download(release.downloadUrl, archive);
    await unpack(archive, unpacked);

    const entries = await readdir(unpacked, { withFileTypes: true });
    const source =
      entries.length === 1 && entries[0].isDirectory()
        ? join(unpacked, entries[0].name)
        : unpacked;

    if (!existsSync(join(source, "notty-desktop"))) {
      throw new Error(
        "The downloaded archive does not contain the Notty desktop binary",
      );
    }

    await mkdir(installDir, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await cp(join(source, entry.name), join(installDir, entry.name), {
        recursive: true,
        force: true,
      });
    }

    for (const name of ["notty-desktop", "notty"]) {
      const binary = join(installDir, name);
      if (existsSync(binary)) await chmod(binary, 0o755);
    }

    await mkdir(binDir, { recursive: true });
    const link = join(binDir, "notty");
    await rm(link, { force: true });
    await symlink(join(installDir, "notty"), link);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};

/**
 * Compare the running version with the newest release and, unless asked to
 * check only, install it. Returns what happened so the CLI can print it.
 */
export const updateNotty = async (
  options: UpdateOptions,
): Promise<UpdateResult> => {
  const current = normalize(options.currentVersion);
  const release = await (options.fetchRelease ?? fetchLatestRelease)();
  const latest = normalize(release.version);

  if (compareVersions(latest, current) <= 0 || options.checkOnly === true) {
    return { current, latest, updated: false };
  }

  await (options.installRelease ??
    ((target: LatestRelease) => installLatestRelease(target, options)))(
    release,
  );

  return { current, latest, updated: true };
};
