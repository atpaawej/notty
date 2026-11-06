/**
 * Private: accelerator syntax, validation and display.
 *
 * The settings dialog captures a key event and the rest of the module only
 * ever sees a canonical accelerator such as `Control+Shift+Space`. Keeping
 * the syntax in one pure file means the Tauri adapter, the persisted value
 * and the dialog cannot disagree about what a shortcut is.
 */

/** Used until the user picks a different combination. */
export const DEFAULT_SHORTCUT = "Control+Shift+Space";

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Super"] as const;

const MODIFIERS: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
  control: "Control",
  ctrl: "Control",
  // CommandOrControl is the portable spelling used by Tauri examples. On the
  // Linux-only v1 app it always means Control.
  commandorcontrol: "Control",
  cmdorcontrol: "Control",
  cmdorctrl: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Super",
  super: "Super",
  command: "Super",
  cmd: "Super",
};

const NAMED_KEYS: Readonly<Record<string, string>> = {
  " ": "Space",
  space: "Space",
  spacebar: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "ArrowUp",
  up: "ArrowUp",
  arrowdown: "ArrowDown",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  left: "ArrowLeft",
  arrowright: "ArrowRight",
  right: "ArrowRight",
};

/** The subset of `KeyboardEvent` the accelerator builder needs. */
export interface ShortcutKeyEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/i;

const functionKey = (key: string): string | null => {
  const match = FUNCTION_KEY.exec(key);
  return match === null ? null : `F${match[1]}`;
};

const keyFromToken = (token: string): string | null => {
  const trimmed = token.trim();
  const named = NAMED_KEYS[trimmed.toLowerCase()];
  if (named !== undefined) return named;

  const fromFunction = functionKey(trimmed);
  if (fromFunction !== null) return fromFunction;

  const letter = /^Key([A-Z])$/i.exec(trimmed);
  if (letter !== null) return letter[1].toUpperCase();

  const digit = /^Digit([0-9])$/i.exec(trimmed);
  if (digit !== null) return digit[1];

  if (/^[A-Z0-9]$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
};

const keyFromEvent = (event: ShortcutKeyEvent): string | null => {
  const code = event.code ?? "";
  if (code === "Space") return "Space";
  const letter = /^Key([A-Z])$/i.exec(code);
  if (letter !== null) return letter[1].toUpperCase();

  const digit = /^Digit([0-9])$/i.exec(code);
  if (digit !== null) return digit[1];

  if (event.key === " ") return "Space";

  const fromKey = keyFromToken(event.key);
  if (fromKey !== null) return fromKey;

  if (event.key.length === 1 && /^[A-Za-z0-9]$/.test(event.key)) {
    return event.key.toUpperCase();
  }
  return null;
};

/**
 * The canonical accelerator for a key press, or `null` when the combination
 * is not usable as a global shortcut. A modifier alone, or Shift plus a
 * letter, would be far too easy to collide with ordinary typing.
 */
export const shortcutFromKeyEvent = (
  event: ShortcutKeyEvent,
): string | null => {
  const key = keyFromEvent(event);
  if (key === null) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");

  const hasCommandModifier =
    event.ctrlKey || event.altKey || event.metaKey || functionKey(key) !== null;
  if (!hasCommandModifier) return null;

  return [...modifiers, key].join("+");
};

/**
 * Normalise a persisted or typed accelerator. Returns `null` for anything
 * the OS plugin cannot be expected to parse.
 */
export const normalizeShortcut = (input: string): string | null => {
  const parts = input
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  const keyToken = parts[parts.length - 1];
  const key = keyFromToken(keyToken);
  if (key === null) return null;

  const modifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier === undefined || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }

  const hasCommandModifier =
    modifiers.has("Control") ||
    modifiers.has("Alt") ||
    modifiers.has("Super") ||
    functionKey(key) !== null;
  if (!hasCommandModifier) return null;

  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+");
};

/** Human-facing labels for the dialog. */
export const formatShortcut = (accelerator: string): string => {
  const normalized = normalizeShortcut(accelerator);
  if (normalized === null) return accelerator;
  return normalized.split("+").map((part) => (part === "Control" ? "Ctrl" : part)).join("+");
};
