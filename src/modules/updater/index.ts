/**
 * updater — owns update checks, staging and restart.
 *
 * Public interface: the reactive controller, its state union and options, the
 * `UpdaterSeam` plus its production and in-memory adapters, and the banner the
 * shell renders. Callers never see GitHub payloads, temporary directories or
 * permission probing.
 */
export {
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_RELEASES_URL,
  UPDATER_REPOSITORY,
  UpdaterError,
  UpdaterSeam,
} from "./service";
export { UpdaterSeam as UpdateSeam } from "./service";
export type {
  UpdateRelease,
  UpdaterEffect,
  UpdaterInstallation,
  UpdaterOperation,
  UpdaterResult,
  UpdaterSeamShape,
} from "./service";
/** Alias used by callers that name the contract rather than the service. */
export type { UpdaterSeamShape as UpdateSeamShape } from "./service";

export {
  compareSemver,
  compareVersions,
  isNewer,
  isNewerVersion,
  isVersionNewer,
  newerVersion,
  parseVersion,
} from "./version";
export type { ParsedVersion } from "./version";

export {
  createUpdater,
  createUpdaterController,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_INITIAL_CHECK_DELAY_MS,
} from "./controller";
export type {
  AvailableState,
  AvailableUpdate,
  CheckOptions,
  CheckingState,
  DownloadingState,
  FailedState,
  IdleState,
  ReadyToRestartState,
  UpToDateState,
  UpdaterController,
  UpdaterOptions,
  UpdaterState,
  UpdaterStatus,
} from "./controller";

export {
  createMemoryUpdater,
  createMemoryUpdaterSeam,
  createMemoryUpdaterSeam as createInMemoryUpdaterSeam,
  updaterMemoryLayer,
} from "./memory-adapter";
export type {
  MemoryUpdater,
  MemoryUpdaterOptions,
  MemoryUpdaterSeam,
} from "./memory-adapter";

export { updaterTauriLayer } from "./tauri-adapter";
export { UpdateBanner } from "./UpdateBanner";
export type { UpdateBannerProps } from "./UpdateBanner";

/** Readable aliases for the two adapters. */
export {
  createMemoryUpdater as updaterMemory,
  createMemoryUpdaterSeam as updaterSeamMemory,
} from "./memory-adapter";
