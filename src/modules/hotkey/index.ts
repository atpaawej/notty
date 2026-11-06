/**
 * hotkey — owns the configurable global shortcut.
 *
 * Public interface: the controller that keeps one accelerator registered and
 * focused, the settings dialog, the shortcut syntax helpers, and the service
 * plus adapters used to wire the OS plugin.
 */
export { createHotkeyController } from "./controller";
export type {
  HotkeyController,
  HotkeyControllerOptions,
  HotkeyState,
} from "./controller";
export { HotkeySettingsDialog } from "./HotkeySettingsDialog";
export type { HotkeySettingsDialogProps } from "./HotkeySettingsDialog";
export { HotkeyError, GlobalHotkey } from "./service";
export type { GlobalHotkeyShape } from "./service";
export { hotkeyTauriLayer } from "./tauri-adapter";
export { createMemoryHotkey, hotkeyMemoryLayer } from "./memory-adapter";
export type {
  MemoryHotkey,
  MemoryHotkeyOptions,
} from "./memory-adapter";
export {
  browserHotkeyPreferences,
  createMemoryHotkeyPreferences,
} from "./preferences";
export type { HotkeyPreferences } from "./preferences";
export {
  DEFAULT_SHORTCUT,
  formatShortcut,
  normalizeShortcut,
  shortcutFromKeyEvent,
} from "./shortcut";
export type { ShortcutKeyEvent } from "./shortcut";
