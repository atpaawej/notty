/**
 * Composition root: the note store, the workspace shell and the one OS hook
 * the workspace needs — flushing pending edits before the window closes.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef } from "react";
import { noteStore } from "./app-runtime";
import { Workspace, type WorkspaceController } from "./modules/workspace";
import "./styles.css";

export default function App() {
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
      // A normal quit gets one chance to write the last pending edit. The
      // second close request sees `closing` and is allowed through.
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (closing) return;
          event.preventDefault();
          closing = true;
          await controller.current?.flush();
          await getCurrentWindow().close();
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

  return <Workspace store={noteStore} onController={onController} />;
}
