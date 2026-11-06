/**
 * Private: the settings dialog for the global shortcut.
 *
 * The dialog captures a real key press, shows the canonical accelerator and
 * reports a failed registration inline. The old shortcut stays active, so a
 * collision is something the user can see and correct — never a silent
 * failure.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { HOTKEY_INVALID_MESSAGE } from "./controller";
import {
  DEFAULT_SHORTCUT,
  formatShortcut,
  shortcutFromKeyEvent,
} from "./shortcut";

export interface HotkeySettingsDialogProps {
  readonly shortcut: string;
  readonly error: string | null;
  readonly onApply: (accelerator: string) => Promise<boolean>;
  readonly onClose: () => void;
}

export function HotkeySettingsDialog({
  shortcut,
  error,
  onApply,
  onClose,
}: HotkeySettingsDialogProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recording) input.current?.focus();
  }, [recording]);

  useEffect(() => {
    if (recording) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [recording, onClose]);

  const apply = async (accelerator: string): Promise<void> => {
    if (pending) return;
    setPending(true);
    setCaptureError(null);
    const accepted = await onApply(accelerator);
    setPending(false);
    if (accepted) setRecording(false);
  };

  const capture = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;

    const bareEscape =
      event.key === "Escape" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey;
    if (bareEscape) {
      setRecording(false);
      setCaptureError(null);
      return;
    }

    const accelerator = shortcutFromKeyEvent(event);
    if (accelerator === null) {
      setCaptureError(HOTKEY_INVALID_MESSAGE);
      return;
    }
    void apply(accelerator);
  };

  const message = captureError ?? error;

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button
            className="settings-close"
            type="button"
            aria-label="Close settings"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-section">
          <h3>Global shortcut</h3>
          <p className="settings-description">
            Raise and focus Notty from any application, even while it is
            minimised.
          </p>

          <div className="hotkey-row">
            <kbd
              className={`hotkey-value${error === null ? "" : " is-unavailable"}`}
            >
              {formatShortcut(shortcut)}
            </kbd>
            {recording ? (
              <input
                ref={input}
                className="hotkey-capture"
                type="text"
                readOnly
                value="Press keys…"
                aria-label="New global shortcut"
                onKeyDown={capture}
              />
            ) : (
              <button
                className="settings-button"
                type="button"
                disabled={pending}
                onClick={() => {
                  setCaptureError(null);
                  setRecording(true);
                }}
              >
                Change…
              </button>
            )}
            <button
              className="settings-button"
              type="button"
              disabled={pending}
              onClick={() => void apply(DEFAULT_SHORTCUT)}
            >
              Use default
            </button>
          </div>

          {message === null ? (
            <p className="settings-status">
              {pending
                ? "Trying that shortcut…"
                : recording
                  ? "Press the new combination now. Esc cancels."
                  : "Active. The shortcut works while Notty is in the background."}
            </p>
          ) : (
            <p className="settings-error" role="alert">
              {message}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
