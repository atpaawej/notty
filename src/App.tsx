/**
 * Composition root: the note store, the workspace shell and the one OS hook
 * the workspace needs — flushing pending edits before the window closes.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AppRuntime } from "./app-runtime";
import { HotkeySettingsDialog } from "./modules/hotkey";
import { UpdateBanner } from "./modules/updater";
import { Workspace, type WorkspaceController } from "./modules/workspace";
import "./styles.css";

export default function App({ runtime }: { readonly runtime: AppRuntime }) {
  const controller = useRef<WorkspaceController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hotkey = useSyncExternalStore(
    runtime.hotkey.subscribe,
    runtime.hotkey.getState,
    runtime.hotkey.getState,
  );
  const update = useSyncExternalStore(
    runtime.updater.subscribe,
    runtime.updater.getState,
    runtime.updater.getState,
  );

  const onController = useCallback((next: WorkspaceController | null) => {
    controller.current = next;
  }, []);

  useEffect(() => {
    const flush = () => {
      void controller.current?.flush();
    };
    window.addEventListener("pagehide", flush);

    let unlisten: (() => void) | undefined;
    let closing = false;

    if (isTauri()) {
      // Intercept window close to flush pending edits, then destroy the window.
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (closing) return;
          event.preventDefault();
          closing = true;
          try {
            await controller.current?.flush();
          } finally {
            await getCurrentWindow().destroy();
          }
        })
        .then((off) => {
          unlisten = off;
        });
    }

    return () => {
      window.removeEventListener("pagehide", flush);
      unlisten?.();
    };
  }, []);

  return (
    <>
      <Workspace
        store={runtime.store}
        attachments={runtime.attachments}
        onController={onController}
        onOpenSettings={() => setSettingsOpen(true)}
        hotkeyError={hotkey.error !== null}
      />
      <UpdateBanner
        state={update}
        release={runtime.updater.getRelease()}
        dismissed={runtime.updater.isDismissed()}
        onDownload={() => {
          void runtime.updater.downloadAndStage();
        }}
        onRestart={() => {
          // Flush the open note and its debounced auto-save before the
          // process is replaced. The controller keeps the window alive if
          // either the flush or the restart fails.
          void controller.current?.flush().then(() => runtime.updater.restart());
        }}
        onDismiss={runtime.updater.dismiss}
        onRetry={() => {
          void runtime.updater.check({ manual: true });
        }}
      />
      {settingsOpen ? (
        <HotkeySettingsDialog
          shortcut={hotkey.shortcut}
          error={hotkey.error}
          onApply={runtime.hotkey.setShortcut}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
