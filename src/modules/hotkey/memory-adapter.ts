/**
 * In-memory adapter for tests and non-Tauri runtimes. Never touches the OS.
 *
 * `taken` models shortcuts another application already owns; triggering a
 * registration calls the same press handler the production adapter would.
 */
import { Effect, Layer } from "effect";
import {
  GlobalHotkey,
  HotkeyError,
  type GlobalHotkeyShape,
} from "./service";

export interface MemoryHotkeyOptions {
  /** Accelerators owned by another application. */
  readonly taken?: ReadonlyArray<string>;
}

export interface MemoryHotkey extends GlobalHotkeyShape {
  /** Test helper: press a registered accelerator. */
  readonly trigger: (accelerator: string) => void;
  /** Test helper: every accelerator currently registered by this app. */
  readonly registered: () => ReadonlyArray<string>;
}

export const createMemoryHotkey = (
  options: MemoryHotkeyOptions = {},
): MemoryHotkey => {
  const taken = new Set(options.taken ?? []);
  const handlers = new Map<string, () => void>();

  return {
    register: (accelerator, onPress) =>
      Effect.suspend(() => {
        if (taken.has(accelerator) || handlers.has(accelerator)) {
          return Effect.fail(
            new HotkeyError({
              operation: "register",
              accelerator,
              cause: new Error("Shortcut already in use"),
            }),
          );
        }
        handlers.set(accelerator, onPress);
        return Effect.void;
      }),
    unregister: (accelerator) =>
      Effect.sync(() => {
        handlers.delete(accelerator);
      }),
    trigger: (accelerator) => {
      handlers.get(accelerator)?.();
    },
    registered: () => [...handlers.keys()],
  };
};

export const hotkeyMemoryLayer = (
  options: MemoryHotkeyOptions = {},
): Layer.Layer<GlobalHotkey> =>
  Layer.succeed(GlobalHotkey, createMemoryHotkey(options));
