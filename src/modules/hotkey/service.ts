/**
 * Private: the global-hotkey service definition.
 *
 * Callers register one accelerator at a time and get a typed error when the
 * OS refuses it — usually because another application already owns it. The
 * runtime adapters in this folder hide the Tauri plugin from the rest of the
 * app.
 */
import { Context, Data, type Effect } from "effect";

export class HotkeyError extends Data.TaggedError("HotkeyError")<{
  readonly operation: "register" | "unregister";
  readonly accelerator: string;
  readonly cause: unknown;
}> {}

export interface GlobalHotkeyShape {
  /**
   * Register an accelerator app-wide. The press handler receives only
   * "pressed" events, never the matching release.
   */
  readonly register: (
    accelerator: string,
    onPress: () => void,
  ) => Effect.Effect<void, HotkeyError>;
  readonly unregister: (
    accelerator: string,
  ) => Effect.Effect<void, HotkeyError>;
}

export class GlobalHotkey extends Context.Service<
  GlobalHotkey,
  GlobalHotkeyShape
>()("notty/GlobalHotkey") {}
