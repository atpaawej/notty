/**
 * Private: the updater service definition.
 *
 * The module checks the public GitHub Releases feed, stages a user-space
 * release without elevation, and restarts into it. The seam below is the only
 * place that touches the network, the filesystem or the process lifecycle.
 * Imported by the adapters and re-exported by ./index — never import this file
 * from outside the module.
 */
import { Context, Data, type Effect } from "effect";

/** The GitHub repository that publishes Notty releases. */
export const UPDATER_REPOSITORY = "atpaawej/notty";

/** The only network endpoint the updater reads. No telemetry or identity. */
export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATER_REPOSITORY}/releases/latest`;

/** Human-facing release page, used by read-only installations. */
export const GITHUB_RELEASES_URL = `https://github.com/${UPDATER_REPOSITORY}/releases`;

/** One published release, reduced to what the app displays and stages. */
export interface UpdateRelease {
  /** Version without the leading `v`, e.g. `0.3.0`. */
  readonly version: string;
  /** Release notes as Markdown, or `""` when the feed had none. */
  readonly notes: string;
  /** The GitHub release page. */
  readonly releaseUrl: string;
  /** The Linux tarball for this machine, when one was published. */
  readonly downloadUrl: string | null;
}

/** What the backend knows about this installation. */
export interface UpdaterInstallation {
  readonly version: string;
  /** Directory holding the running executable. */
  readonly installDir: string;
  /** True when this process can write into `installDir`. */
  readonly writable: boolean;
  /** True when the app lives in the user's `~/.local/share/notty`. */
  readonly userSpace: boolean;
}

export type UpdaterOperation =
  | "currentVersion"
  | "installation"
  | "check"
  | "download"
  | "stage"
  | "restart";

/**
 * Every updater failure is typed and reported as state. The controller never
 * throws at a caller: a flaky network must not interrupt typing.
 */
export class UpdaterError extends Data.TaggedError("UpdaterError")<{
  readonly operation: UpdaterOperation;
  readonly cause: unknown;
}> {}

export type UpdaterEffect<A> = Effect.Effect<A, UpdaterError>;
export type UpdaterResult<A> = UpdaterEffect<A> | Promise<A>;

/**
 * The seam behind the updater module. The production adapter talks to the
 * Tauri shell; the memory adapter models the same transitions without I/O.
 *
 * Check/installation methods are optional and have familiar aliases so a
 * small hand-written test seam only needs the few methods its scenario uses.
 */
export interface UpdaterSeamShape {
  readonly currentVersion?: () => UpdaterResult<string>;
  readonly installation?: () => UpdaterResult<UpdaterInstallation>;
  /** The newest published release, or `null` when nothing is published. */
  readonly latestRelease?: () => UpdaterResult<UpdateRelease | null>;
  /** Alias that receives the running version. */
  readonly checkForUpdate?: (
    currentVersion: string,
  ) => UpdaterResult<UpdateRelease | null>;
  /** Short alias for `checkForUpdate`. */
  readonly check?: (
    currentVersion: string,
  ) => UpdaterResult<UpdateRelease | null>;
  /** Alias for the write-permission fact. */
  readonly canInstallInPlace?: () => UpdaterResult<boolean>;
  /**
   * Download and verify the release, then atomically swap the staged files
   * into the installation directory. Progress is a fraction from 0 to 1.
   */
  readonly downloadAndStage: (
    release: UpdateRelease,
    onProgress: (progress: number) => void,
  ) => UpdaterResult<void>;
  /** Relaunch the application into the staged version. */
  readonly restart: () => UpdaterResult<void>;
}

export class UpdaterSeam extends Context.Service<
  UpdaterSeam,
  UpdaterSeamShape
>()("notty/UpdaterSeam") {}
