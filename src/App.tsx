/**
 * Composition root: the note store, the workspace shell and the one OS hook
 * the workspace needs — flushing pending edits before the window closes.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef } from "react";
import type { AppRuntime } from "./app-runtime";
import { Workspace, type WorkspaceController } from "./modules/workspace";
import "./styles.css";

export default function App({ runtime }: { readonly runtime: AppRuntime }) {
  const controller = useRef<WorkspaceController | null>(null);

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
    <Workspace
      store={runtime.store}
      attachments={runtime.attachments}
      onController={onController}
    />
  );
}
