/**
 * In-memory adapter for tests and non-Tauri runtimes. Never touches the
 * network, the filesystem or the process lifecycle.
 *
 * The options model the interesting installation and network states:
 * user-space write access, read-only system packages, a newer release,
 * failed checks and failed or partial downloads.
 */
import { Effect, Layer } from "effect";
import {
  UpdaterError,
  UpdaterSeam,
  type UpdateRelease,
  type UpdaterInstallation,
  type UpdaterSeamShape,
} from "./service";
import {
  createUpdater,
  type UpdaterController,
} from "./controller";

export interface MemoryUpdaterOptions {
  /** The version this installation currently runs. */
  readonly currentVersion?: string;
  /** Alias for `currentVersion`. */
  readonly version?: string;
  /** The newest published version; defaults to the current version. */
  readonly latestVersion?: string | null;
  /** Alias for `latestVersion`. */
  readonly availableVersion?: string;
  /** Alias for `latestVersion`. */
  readonly latest?: string | null;
  /** Alias for `latestVersion`. */
  readonly newVersion?: string;
  /** Release notes shown in the in-app banner. */
  readonly notes?: string;
  /** Alias for `notes`. */
  readonly releaseNotes?: string;
  readonly releaseUrl?: string;
  readonly downloadUrl?: string | null;
  /** The release returned by `latestRelease`; overrides the version fields. */
  readonly release?: UpdateRelease | null;
  /** False models a read-only system install such as `/usr/bin`. */
  readonly isUserSpace?: boolean;
  /** Alias for `isUserSpace`. */
  readonly writable?: boolean;
  /** True models a read-only system install; inverse of `isUserSpace`. */
  readonly readOnly?: boolean;
  /** Explicit installation info; overrides the flags above. */
  readonly installation?: Partial<UpdaterInstallation>;
  /** Fail the release check instead of returning a release. */
  readonly failCheck?: boolean | string | Error;
  /** Alias for `failCheck`. */
  readonly networkError?: boolean | string | Error;
  /** Fail the download after `downloadProgress` has been reported. */
  readonly failDownload?: boolean | string | Error;
  /** Alias for `failDownload`. */
  readonly downloadError?: boolean | string | Error;
  /** Progress fractions reported during a successful download. */
  readonly downloadProgress?: ReadonlyArray<number>;
  /** Alias for `downloadProgress`. */
  readonly progress?: ReadonlyArray<number>;
  /** Milliseconds between progress reports. Zero keeps tests synchronous. */
  readonly downloadDelayMs?: number;
  /** Milliseconds before a restart resolves. */
  readonly restartDelayMs?: number;
}

export interface MemoryUpdaterSeam extends UpdaterSeamShape {
  readonly checkCount: () => number;
  readonly downloadCount: () => number;
  readonly restartCount: () => number;
  readonly stagedRelease: () => UpdateRelease | null;
  readonly setLatestVersion: (version: string | null) => void;
  readonly setRelease: (release: UpdateRelease | null) => void;
  readonly setUserSpace: (isUserSpace: boolean) => void;
}

const failure = (cause: boolean | string | Error): UpdaterError => {
  if (cause instanceof UpdaterError) return cause;
  const error =
    cause instanceof Error
      ? cause
      : new Error(typeof cause === "string" ? cause : "Update failed");
  return new UpdaterError({ operation: "check", cause: error });
};

const wait = (milliseconds: number): Promise<void> =>
  milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createMemoryUpdaterSeam = (
  options: MemoryUpdaterOptions = {},
): MemoryUpdaterSeam => {
  const current = options.currentVersion ?? options.version ?? "0.0.0";
  let latest =
    options.latestVersion ??
    options.latest ??
    options.availableVersion ??
    options.newVersion ??
    null;
  let isUserSpace =
    options.isUserSpace ??
    options.writable ??
    (options.readOnly === undefined ? true : !options.readOnly);
  const failCheck = options.failCheck ?? options.networkError;
  const failDownload = options.failDownload ?? options.downloadError;
  const downloadProgress =
    options.downloadProgress ?? options.progress ?? [0.25, 0.5, 0.75, 1];
  let release: UpdateRelease | null = options.release ?? null;
  let staged: UpdateRelease | null = null;
  let checks = 0;
  let downloads = 0;
  let restarts = 0;

  const releaseFor = (): UpdateRelease | null => {
    if (release !== null) return release;
    if (latest === null || latest === undefined) return null;
    return {
      version: latest,
      notes: options.notes ?? options.releaseNotes ?? "",
      releaseUrl:
        options.releaseUrl ??
        `https://github.com/atpaawej/notty/releases/tag/v${latest}`,
      downloadUrl:
        options.downloadUrl === undefined
          ? `https://github.com/atpaawej/notty/releases/download/v${latest}/notty-v${latest}-linux-x86_64.tar.gz`
          : options.downloadUrl,
    };
  };

  const installation = (): UpdaterInstallation => ({
    version: current,
    installDir: isUserSpace ? "/home/test/.local/share/notty" : "/usr/bin",
    writable: isUserSpace,
    userSpace: isUserSpace,
    ...options.installation,
  });

  return {
    currentVersion: () => Effect.succeed(current),
    installation: () => Effect.succeed(installation()),
    latestRelease: () =>
      Effect.suspend(() => {
        checks += 1;
        if (failCheck === true) {
          return Effect.fail(failure("Update check failed"));
        }
        if (failCheck !== undefined && failCheck !== false) {
          return Effect.fail(failure(failCheck));
        }
        return Effect.succeed(releaseFor());
      }),
    downloadAndStage: (target, onProgress) =>
      Effect.promise(async () => {
        downloads += 1;
        for (const progress of downloadProgress) {
          await wait(options.downloadDelayMs ?? 0);
          onProgress(progress);
          if (failDownload !== undefined && failDownload !== false) {
            throw failure(failDownload);
          }
        }
        if (failDownload !== undefined && failDownload !== false) {
          throw failure(failDownload);
        }
        staged = target;
      }),
    restart: () =>
      Effect.promise(async () => {
        restarts += 1;
        await wait(options.restartDelayMs ?? 0);
      }),
    checkCount: () => checks,
    downloadCount: () => downloads,
    restartCount: () => restarts,
    stagedRelease: () => staged,
    setLatestVersion: (version) => {
      latest = version;
      release = null;
    },
    setRelease: (next) => {
      release = next;
      if (next !== null) latest = next.version;
    },
    setUserSpace: (next) => {
      isUserSpace = next;
    },
  };
};

export const updaterMemoryLayer = (
  options: MemoryUpdaterOptions = {},
): Layer.Layer<UpdaterSeam> =>
  Layer.succeed(UpdaterSeam, createMemoryUpdaterSeam(options));

/** A memory adapter plus the controller, ready for an integration test. */
export interface MemoryUpdater extends UpdaterController {
  readonly seam: MemoryUpdaterSeam;
}

export const createMemoryUpdater = (
  options: MemoryUpdaterOptions = {},
): MemoryUpdater => {
  const seam = createMemoryUpdaterSeam(options);
  const controller = createUpdater(seam, { autoCheck: false });
  return {
    ...controller,
    seam,
    checkCount: seam.checkCount,
    downloadCount: seam.downloadCount,
    restartCount: seam.restartCount,
    setLatestVersion: seam.setLatestVersion,
    setUserSpace: seam.setUserSpace,
  } as MemoryUpdater;
};
