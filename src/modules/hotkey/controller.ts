/**
 * Private: the global-hotkey controller.
 *
 * Framework-free so the registration rules are testable: register the new
 * accelerator first, keep the old one working if the OS refuses, and only
 * persist a shortcut after the OS has accepted it.
 */
import { Effect } from "effect";
import {
  DEFAULT_SHORTCUT,
  normalizeShortcut,
} from "./shortcut";
import type { HotkeyPreferences } from "./preferences";
import type { GlobalHotkeyShape } from "./service";

export const HOTKEY_TAKEN_MESSAGE =
  "That shortcut is unavailable — another app may already be using it. Try a different combination.";
export const HOTKEY_UNAVAILABLE_MESSAGE =
  "The saved shortcut is unavailable. Choose a different combination.";
export const HOTKEY_INVALID_MESSAGE =
  "Use a letter, number, function key or arrow key together with Ctrl, Alt or Super.";

export interface HotkeyState {
  /** The accelerator the app is trying to keep active. */
  readonly shortcut: string;
  /** True once the OS has accepted the accelerator. */
  readonly registered: boolean;
  /** Why the shortcut is not active, or why the last change failed. */
  readonly error: string | null;
}

export interface HotkeyControllerOptions {
  /** Raise and focus the main window when the shortcut is pressed. */
  readonly onPress: () => void;
  /** Shortcut used before the user chooses one. */
  readonly defaultShortcut?: string;
}

export interface HotkeyController {
  readonly getState: () => HotkeyState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Resolves after the first registration attempt has settled. */
  readonly ready: Promise<void>;
  /**
   * Try to make `accelerator` the active shortcut. Resolves `false` and
   * leaves the previous shortcut active when the OS refuses it.
   */
  readonly setShortcut: (accelerator: string) => Promise<boolean>;
  /** Unregister and stop notifying listeners. */
  readonly dispose: () => void;
}

export function createHotkeyController(
  hotkey: GlobalHotkeyShape,
  preferences: HotkeyPreferences,
  options: HotkeyControllerOptions,
): HotkeyController {
  const fallback =
    normalizeShortcut(options.defaultShortcut ?? DEFAULT_SHORTCUT) ??
    DEFAULT_SHORTCUT;
  const saved = preferences.read();
  const initial = (saved === null ? null : normalizeShortcut(saved)) ?? fallback;

  let current = initial;
  let state: HotkeyState = {
    shortcut: current,
    registered: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let chain: Promise<unknown> = Promise.resolve();
  let disposed = false;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (next: HotkeyState): void => {
    state = next;
    emit();
  };

  /** Serialise registration so two quick changes cannot interleave. */
  const enqueue = <A>(task: () => Promise<A>): Promise<A> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const attach = (accelerator: string): Promise<boolean> => {
    const result = Effect.runPromise(
      hotkey.register(accelerator, () => {
        options.onPress();
      }),
    );
    return result.then(
      () => true,
      () => false,
    );
  };

  const detach = async (accelerator: string): Promise<void> => {
    try {
      await Effect.runPromise(hotkey.unregister(accelerator));
    } catch {
      // The old shortcut may stay grabbed until the app exits. The newly
      // accepted one is already active, so this is not worth failing the
      // user's change over.
    }
  };

  const install = async (accelerator: string): Promise<boolean> => {
    if (disposed) return false;
    const accepted = await attach(accelerator);
    if (!accepted) {
      update({
        ...state,
        shortcut: current,
        error:
          state.registered || accelerator === current
            ? HOTKEY_TAKEN_MESSAGE
            : HOTKEY_UNAVAILABLE_MESSAGE,
      });
      return false;
    }

    const previous = current;
    const wasRegistered = state.registered;
    current = accelerator;
    update({ shortcut: current, registered: true, error: null });
    preferences.write(current);

    if (wasRegistered && previous !== accelerator) {
      await detach(previous);
    }
    return true;
  };

  const ready = enqueue(async () => {
    if (disposed) return;
    const accepted = await attach(current);
    if (!accepted) {
      update({
        ...state,
        shortcut: current,
        registered: false,
        error: HOTKEY_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    update({ shortcut: current, registered: true, error: null });
  }).then(() => undefined);

  const setShortcut = async (accelerator: string): Promise<boolean> => {
    const next = normalizeShortcut(accelerator);
    if (next === null) {
      update({ ...state, error: HOTKEY_INVALID_MESSAGE });
      return false;
    }
    if (next === current && state.registered) {
      update({ ...state, error: null });
      return true;
    }
    return enqueue(() => install(next));
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready,
    setShortcut,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const accelerator = current;
      void enqueue(async () => {
        if (state.registered) await detach(accelerator);
        update({ ...state, registered: false });
      });
      listeners.clear();
    },
  };
}
