/**
 * Private: where the chosen accelerator is remembered.
 *
 * The shortcut is app preference, not vault content, so it lives in WebView
 * local storage. A missing or unreadable value falls back to the default;
 * the dialog still shows it, so the user can always change it.
 */
export interface HotkeyPreferences {
  readonly read: () => string | null;
  readonly write: (accelerator: string) => void;
}

const STORAGE_KEY = "notty.hotkey";

export const browserHotkeyPreferences: HotkeyPreferences = {
  read: () => {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  write: (accelerator) => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, accelerator);
    } catch {
      // Storage can be unavailable in a locked-down WebView. The shortcut
      // still works for this session; only persistence is lost.
    }
  },
};

export const createMemoryHotkeyPreferences = (
  initial: string | null = null,
): HotkeyPreferences => {
  let value = initial;
  return {
    read: () => value,
    write: (accelerator) => {
      value = accelerator;
    },
  };
};
