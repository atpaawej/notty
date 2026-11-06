/**
 * Private: the updater state machine.
 *
 * Framework-free so the transitions are testable: check quietly, stage in the
 * background, then offer a restart. Nothing here ever throws at a caller — a
 * failed check or a partial download becomes `Failed` and the app keeps
 * working.
 */
import { Effect } from "effect";
import { compareVersions } from "./version";
import {
  UpdaterError,
  type UpdateRelease,
  type UpdaterInstallation,
  type UpdaterResult,
  type UpdaterSeamShape,
} from "./service";

/** How long the first automatic check waits after launch. */
export const DEFAULT_INITIAL_CHECK_DELAY_MS = 8_000;
/** How often the app looks for a new release while it stays open. */
export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export interface IdleState {
  readonly status: "Idle";
}

export interface CheckingState {
  readonly status: "Checking";
}

export interface UpToDateState {
  readonly status: "UpToDate";
  readonly version: string;
}

export interface AvailableState {
  readonly status: "Available";
  readonly version: string;
  readonly notes: string;
  /** False when the installation directory is read-only. */
  readonly isUserSpace: boolean;
}

export interface DownloadingState {
  readonly status: "Downloading";
  /** Fraction from 0 to 1. */
  readonly progress: number;
}

export interface ReadyToRestartState {
  readonly status: "ReadyToRestart";
  readonly version: string;
}

export interface FailedState {
  readonly status: "Failed";
  readonly error: string;
}

export type UpdaterState =
  | IdleState
  | CheckingState
  | UpToDateState
  | AvailableState
  | DownloadingState
  | ReadyToRestartState
  | FailedState;

/** Alias kept for callers that call the state a status. */
export type UpdaterStatus = UpdaterState;

/** The newest release is available and may be staged. */
export interface AvailableUpdate {
  readonly version: string;
  readonly notes: string;
  readonly isUserSpace: boolean;
  readonly releaseUrl: string;
  readonly downloadUrl: string | null;
}

export interface CheckOptions {
  /**
   * A manual check may show a failure in the UI. Background checks stay
   * silent and only update the state stream.
   */
  readonly manual?: boolean;
}

export interface UpdaterOptions {
  /** Check once shortly after launch and then on an interval. */
  readonly autoCheck?: boolean;
  /** Start a user-space download as soon as an update is found. */
  readonly autoDownload?: boolean;
  /** Delay before the first automatic check. */
  readonly initialDelayMs?: number;
  /** Delay between automatic checks. Zero disables the interval. */
  readonly checkIntervalMs?: number;
  /** Run after the update state changes. */
  readonly onStateChange?: (state: UpdaterState) => void;
  /**
   * A pre-restart hook. Production flushes the open note and pending index
   * work before the process is replaced.
   */
  readonly beforeRestart?: () => Promise<void> | void;
  /** Quiet diagnostics seam; defaults to the console. */
  readonly log?: (message: string, cause?: unknown) => void;
}

export interface UpdaterController {
  readonly getState: () => UpdaterState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Resolves after the first automatic check has settled. */
  readonly ready: Promise<void>;
  /** Query GitHub Releases. Repeated in-flight calls share one request. */
  readonly check: (options?: CheckOptions | boolean) => Promise<void>;
  /** Alias for `check`. */
  readonly checkForUpdate: (options?: CheckOptions | boolean) => Promise<void>;
  /** Alias for `check`. */
  readonly checkForUpdates: (options?: CheckOptions | boolean) => Promise<void>;
  /**
   * Download and stage the available release. Returns false when the update
   * cannot be staged in place (for example a read-only system install).
   */
  readonly downloadAndStage: (release?: UpdateRelease) => Promise<boolean>;
  /** Alias for `downloadAndStage`. */
  readonly download: (release?: UpdateRelease) => Promise<boolean>;
  /** Alias for `downloadAndStage`. */
  readonly stage: (release?: UpdateRelease) => Promise<boolean>;
  /** Flush pending work and relaunch into the staged version. */
  readonly restart: () => Promise<boolean>;
  /** Alias for `restart`. */
  readonly restartAndApply: () => Promise<boolean>;
  /** Hide the notification; the staged update applies on the next launch. */
  readonly dismiss: () => void;
  /** Alias for `dismiss`. */
  readonly dismissNotification: () => void;
  readonly isDismissed: () => boolean;
  /** The release backing the current `Available` state, if any. */
  readonly getRelease: () => UpdateRelease | null;
  /** Begin automatic checks when they were not started at construction. */
  readonly start: () => void;
  readonly dispose: () => void;
}

interface SeamOptions extends UpdaterOptions {
  readonly seam: UpdaterSeamShape;
}

const isPromise = <A>(value: unknown): value is Promise<A> =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { then?: unknown }).then === "function";

/** Accept Effect or Promise so a hand-written test seam stays small. */
const run = async <A>(value: UpdaterResult<A>): Promise<A> => {
  if (isPromise<A>(value)) return value;
  return Effect.runPromise(value);
};

const readCurrentVersion = async (
  seam: UpdaterSeamShape,
): Promise<string> => {
  if (seam.currentVersion !== undefined) return run(seam.currentVersion());
  if (seam.installation !== undefined) {
    return (await run(seam.installation())).version;
  }
  throw new UpdaterError({
    operation: "currentVersion",
    cause: new Error("The updater seam has no current version"),
  });
};

const readInstallation = async (
  seam: UpdaterSeamShape,
  currentVersion: string,
): Promise<UpdaterInstallation> => {
  if (seam.installation !== undefined) return run(seam.installation());
  if (seam.canInstallInPlace !== undefined) {
    const writable = await run(seam.canInstallInPlace());
    return {
      version: currentVersion,
      installDir: "",
      writable,
      userSpace: writable,
    };
  }
  return {
    version: currentVersion,
    installDir: "",
    writable: false,
    userSpace: false,
  };
};

const readLatestRelease = async (
  seam: UpdaterSeamShape,
  currentVersion: string,
): Promise<UpdateRelease | null> => {
  if (seam.latestRelease !== undefined) return run(seam.latestRelease());
  if (seam.checkForUpdate !== undefined) {
    return run(seam.checkForUpdate(currentVersion));
  }
  if (seam.check !== undefined) return run(seam.check(currentVersion));
  throw new UpdaterError({
    operation: "check",
    cause: new Error("The updater seam has no release check"),
  });
};

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "The update could not be completed.";
};

const logCause = (cause: unknown): unknown => {
  if (
    cause !== null &&
    typeof cause === "object" &&
    "cause" in cause
  ) {
    return (cause as { readonly cause: unknown }).cause;
  }
  return cause;
};

const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * Add read-only aliases that alternate spellings of the discriminant use.
 * Keeping them non-enumerable means `toEqual` on the documented shape still
 * sees only the documented fields.
 */
const decorate = (
  state: UpdaterState,
  release: UpdateRelease | null,
  manual = false,
): UpdaterState => {
  const aliases: Record<string, unknown> = {
    kind: state.status,
    type: state.status,
    phase: state.status,
    state: state.status,
    manual,
  };

  switch (state.status) {
    case "UpToDate":
      aliases.currentVersion = state.version;
      break;
    case "Available":
      aliases.releaseNotes = state.notes;
      aliases.readOnly = !state.isUserSpace;
      aliases.isReadOnly = !state.isUserSpace;
      aliases.releaseUrl = release?.releaseUrl ?? "";
      aliases.downloadUrl = release?.downloadUrl ?? null;
      aliases.url = release?.releaseUrl ?? "";
      break;
    case "Downloading":
      aliases.percent = Math.round(state.progress * 100);
      break;
    case "ReadyToRestart":
      aliases.pendingVersion = state.version;
      break;
    case "Failed":
      aliases.message = state.error;
      break;
    default:
      break;
  }

  for (const [key, value] of Object.entries(aliases)) {
    Object.defineProperty(state, key, {
      value,
      enumerable: false,
      configurable: true,
    });
  }
  return state;
};

export function createUpdater(
  seam: UpdaterSeamShape,
  options?: UpdaterOptions,
): UpdaterController;
export function createUpdater(options: SeamOptions): UpdaterController;
export function createUpdater(
  first: UpdaterSeamShape | SeamOptions,
  second: UpdaterOptions = {},
): UpdaterController {
  const supplied = "seam" in first ? first.seam : first;
  const options: UpdaterOptions = "seam" in first ? first : second;
  const seam: UpdaterSeamShape = supplied;

  const initialDelayMs =
    options.initialDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS;
  const checkIntervalMs =
    options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const autoCheck = options.autoCheck === true;
  const autoDownload = options.autoDownload === true;
  const log =
    options.log ??
    ((message: string, cause?: unknown) => {
      console.warn(message, cause);
    });

  let state: UpdaterState = decorate({ status: "Idle" }, null);
  let release: UpdateRelease | null = null;
  let dismissed = false;
  let manualCheck = false;
  let disposed = false;
  const beforeRestart = options.beforeRestart;
  let checkInFlight: Promise<void> | null = null;
  let downloadInFlight: Promise<boolean> | null = null;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let resolveReady: () => void = () => undefined;

  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
    options.onStateChange?.(state);
  };

  const withDismissed = (next: UpdaterState): UpdaterState => {
    Object.defineProperty(next, "dismissed", {
      value: dismissed,
      enumerable: false,
      configurable: true,
    });
    return next;
  };

  const update = (
    next: UpdaterState,
    nextRelease: UpdateRelease | null = release,
  ): void => {
    release = nextRelease;
    state = withDismissed(decorate(next, nextRelease, manualCheck));
    emit();
  };

  const clearTimers = (): void => {
    if (initialTimer !== null) {
      clearTimeout(initialTimer);
      initialTimer = null;
    }
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };

  const start = (): void => {
    if (!autoCheck || disposed || initialTimer !== null || intervalTimer !== null) {
      if (!autoCheck) resolveReady();
      return;
    }
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void check().finally(() => {
        if (disposed || checkIntervalMs <= 0) return;
        intervalTimer = setInterval(() => {
          void check();
        }, checkIntervalMs);
      });
    }, Math.max(0, initialDelayMs));
  };

  const check = (checkOptions: CheckOptions | boolean = {}): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (checkInFlight !== null) {
      // Rapid clicks and overlapping timers share one request. This is the
      // debounce: only the newest caller's failure visibility is kept.
      manualCheck = manualCheck || checkOptions === true || (
        typeof checkOptions === "object" && checkOptions.manual === true
      );
      return checkInFlight;
    }

    manualCheck =
      checkOptions === true ||
      (typeof checkOptions === "object" && checkOptions.manual === true);
    dismissed = false;

    checkInFlight = (async () => {
      update({ status: "Checking" }, null);
      try {
        const currentVersion = await readCurrentVersion(seam);
        const [installation, latest] = await Promise.all([
          readInstallation(seam, currentVersion),
          readLatestRelease(seam, currentVersion),
        ]);

        if (latest === null) {
          update({ status: "UpToDate", version: currentVersion }, null);
          return;
        }

        if (compareVersions(latest.version, currentVersion) <= 0) {
          update({ status: "UpToDate", version: currentVersion }, null);
          return;
        }

        const canStage =
          installation.writable && latest.downloadUrl !== null;
        update(
          {
            status: "Available",
            version: latest.version,
            notes: latest.notes,
            isUserSpace: canStage,
          },
          latest,
        );

        if (autoDownload && canStage) {
          void downloadAndStage();
        }
      } catch (cause) {
        const error = errorMessage(logCause(cause));
        log("Notty could not check for updates", logCause(cause));
        update({ status: "Failed", error }, null);
      } finally {
        checkInFlight = null;
        resolveReady();
      }
    })();

    return checkInFlight;
  };

  const downloadAndStage = (
    requestedRelease?: UpdateRelease,
  ): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    if (downloadInFlight !== null) return downloadInFlight;
    const available = requestedRelease ?? release;
    if (
      state.status !== "Available" ||
      !state.isUserSpace ||
      available === null
    ) {
      return Promise.resolve(false);
    }

    const target = available;
    downloadInFlight = (async () => {
      update({ status: "Downloading", progress: 0 }, target);
      try {
        await run(
          seam.downloadAndStage(target, (progress) => {
            if (disposed) return;
            if (state.status !== "Downloading") return;
            update(
              { status: "Downloading", progress: clampProgress(progress) },
              target,
            );
          }),
        );
        update({ status: "ReadyToRestart", version: target.version }, target);
        return true;
      } catch (cause) {
        const error = errorMessage(logCause(cause));
        log("Notty could not download the update", logCause(cause));
        update({ status: "Failed", error }, target);
        return false;
      } finally {
        downloadInFlight = null;
      }
    })();

    return downloadInFlight;
  };

  const restart = async (): Promise<boolean> => {
    if (disposed || state.status !== "ReadyToRestart") return false;
    try {
      if (beforeRestart !== undefined) await beforeRestart();
      await run(seam.restart());
      return true;
    } catch (cause) {
      const error = errorMessage(logCause(cause));
      log("Notty could not restart into the update", logCause(cause));
      update({ status: "Failed", error }, release);
      return false;
    }
  };

  const dismiss = (): void => {
    dismissed = true;
    // A fresh object makes `useSyncExternalStore` notice the change even
    // though the documented status fields stay the same.
    state = withDismissed(
      decorate({ ...state } as UpdaterState, release, manualCheck),
    );
    emit();
  };

  const controller: UpdaterController = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready,
    check,
    checkForUpdate: check,
    checkForUpdates: check,
    downloadAndStage,
    download: downloadAndStage,
    stage: downloadAndStage,
    restart,
    restartAndApply: restart,
    dismiss,
    dismissNotification: dismiss,
    isDismissed: () => dismissed,
    getRelease: () => release,
    start,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimers();
      listeners.clear();
      resolveReady();
    },
  };

  if (!autoCheck) resolveReady();
  else start();

  return controller;
}

/** Readable alias matching the other modules' controller naming. */
export const createUpdaterController = createUpdater;
