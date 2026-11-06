/**
 * Production adapter for the Tauri WebView.
 *
 * The plugin raises the handler from any application, including while Notty
 * is minimised. A failed grab — typically a shortcut already owned by the
 * window manager — rejects the command, which becomes a `HotkeyError` so the
 * settings dialog can ask for a different combination instead of failing
 * silently.
 */
import { isTauri } from "@tauri-apps/api/core";
import {
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { Effect, Layer } from "effect";
import {
  GlobalHotkey,
  HotkeyError,
  type GlobalHotkeyShape,
} from "./service";

const tauriHotkey: GlobalHotkeyShape = {
  register: (accelerator, onPress) =>
    Effect.tryPromise({
      try: async () => {
        if (!isTauri()) {
          throw new Error("Global shortcuts need the Notty desktop window");
        }
        await register(accelerator, (event) => {
          if (event.state === "Pressed") onPress();
        });
      },
      catch: (cause) =>
        new HotkeyError({ operation: "register", accelerator, cause }),
    }),
  unregister: (accelerator) =>
    Effect.tryPromise({
      try: async () => {
        if (!isTauri()) return;
        await unregister(accelerator);
      },
      catch: (cause) =>
        new HotkeyError({ operation: "unregister", accelerator, cause }),
    }),
};

export const hotkeyTauriLayer = Layer.succeed(GlobalHotkey, tauriHotkey);
