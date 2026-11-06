/**
 * Private: the non-intrusive update banner.
 *
 * A background failure stays invisible. An available update offers release
 * notes and either a background download (user space) or a release link
 * (read-only system install). A staged update offers restart or dismiss.
 */
import type { UpdateRelease } from "./service";
import type { UpdaterState } from "./controller";

export interface UpdateBannerProps {
  readonly state: UpdaterState;
  readonly release: UpdateRelease | null;
  readonly dismissed: boolean;
  readonly onDownload: () => void;
  readonly onRestart: () => void;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
}

const releaseUrlOf = (
  state: UpdaterState,
  release: UpdateRelease | null,
): string => {
  if (release !== null) return release.releaseUrl;
  return (state as UpdaterState & { readonly releaseUrl?: string }).releaseUrl ?? "";
};

const isManualFailure = (state: UpdaterState): boolean =>
  (state as UpdaterState & { readonly manual?: boolean }).manual === true;

export function UpdateBanner({
  state,
  release,
  dismissed,
  onDownload,
  onRestart,
  onDismiss,
  onRetry,
}: UpdateBannerProps) {
  if (state.status === "Idle" || state.status === "Checking") return null;
  if (state.status === "UpToDate") return null;
  if (state.status === "Failed" && !isManualFailure(state)) return null;
  if (dismissed && state.status !== "Downloading") return null;

  const notes = release?.notes.trim() ?? "";

  return (
    <aside className="update-banner" aria-live="polite" role="status">
      <div className="update-banner-heading">
        <strong>
          {state.status === "ReadyToRestart"
            ? "Notty update ready"
            : state.status === "Downloading"
              ? "Downloading update…"
              : state.status === "Failed"
                ? "Update check failed"
                : `Notty ${state.version} is available`}
        </strong>
        {state.status === "Downloading" ? null : (
          <button
            className="update-banner-close"
            type="button"
            aria-label="Dismiss update notification"
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </div>

      {state.status === "Available" ? (
        <>
          <p className="update-banner-copy">
            {state.isUserSpace
              ? "The new version downloads in the background. Your notes stay open."
              : "This copy lives in a system package directory, so Notty cannot replace it in place."}
          </p>
          {notes.length > 0 ? (
            <details className="update-banner-notes">
              <summary>Release notes</summary>
              <div>{notes}</div>
            </details>
          ) : null}
          {state.isUserSpace ? (
            <button className="update-banner-action" type="button" onClick={onDownload}>
              Download update
            </button>
          ) : (
            <a
              className="update-banner-action"
              href={releaseUrlOf(state, release)}
              target="_blank"
              rel="noreferrer"
            >
              View release and download
            </a>
          )}
        </>
      ) : null}

      {state.status === "Downloading" ? (
        <div
          className="update-banner-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.progress * 100)}
        >
          <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      ) : null}

      {state.status === "ReadyToRestart" ? (
        <>
          <p className="update-banner-copy">
            Version {state.version} is staged. Restart when you are ready — or
            dismiss and it will apply the next time Notty opens.
          </p>
          <button className="update-banner-action" type="button" onClick={onRestart}>
            Restart now
          </button>
        </>
      ) : null}

      {state.status === "Failed" ? (
        <>
          <p className="update-banner-copy">{state.error}</p>
          <button className="update-banner-action" type="button" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : null}
    </aside>
  );
}
