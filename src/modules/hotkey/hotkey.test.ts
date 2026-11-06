import { describe, expect, it } from "vitest";
import {
  createHotkeyController,
  createMemoryHotkey,
  createMemoryHotkeyPreferences,
  DEFAULT_SHORTCUT,
  formatShortcut,
  normalizeShortcut,
  shortcutFromKeyEvent,
  type ShortcutKeyEvent,
} from "./index";

const keyEvent = (
  overrides: Partial<ShortcutKeyEvent>,
): ShortcutKeyEvent => ({
  key: "",
  code: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("shortcut syntax", () => {
  it("builds a canonical accelerator from a key press", () => {
    expect(
      shortcutFromKeyEvent(
        keyEvent({ key: " ", code: "Space", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("Control+Shift+Space");
  });

  it("uses physical codes so Shift does not turn a digit into punctuation", () => {
    expect(
      shortcutFromKeyEvent(
        keyEvent({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("Control+Shift+1");
  });

  it("maps the Linux meta key to Super", () => {
    expect(
      shortcutFromKeyEvent(
        keyEvent({ key: "k", code: "KeyK", altKey: true, metaKey: true }),
      ),
    ).toBe("Alt+Super+K");
  });

  it("allows a function key without a modifier", () => {
    expect(shortcutFromKeyEvent(keyEvent({ key: "F9", code: "F9" }))).toBe(
      "F9",
    );
  });

  it("rejects modifier-only and shift-only combinations", () => {
    expect(
      shortcutFromKeyEvent(keyEvent({ key: "Control", code: "ControlLeft", ctrlKey: true })),
    ).toBeNull();
    expect(
      shortcutFromKeyEvent(keyEvent({ key: "A", code: "KeyA", shiftKey: true })),
    ).toBeNull();
  });

  it("normalises stored spellings", () => {
    expect(normalizeShortcut("ctrl + shift + space")).toBe(
      "Control+Shift+Space",
    );
    expect(normalizeShortcut("CommandOrControl+Shift+C")).toBe(
      "Control+Shift+C",
    );
    expect(normalizeShortcut("Super+KeyK")).toBe("Super+K");
  });

  it("rejects incomplete, duplicate and modifier-only shortcuts", () => {
    expect(normalizeShortcut("Control+Shift")).toBeNull();
    expect(normalizeShortcut("Control+Control+A")).toBeNull();
    expect(normalizeShortcut("Shift+A")).toBeNull();
  });

  it("formats the modifier for display", () => {
    expect(formatShortcut("Control+Shift+Space")).toBe("Ctrl+Shift+Space");
  });
});

describe("hotkey controller", () => {
  it("registers the default shortcut and raises the window on press", async () => {
    const hotkey = createMemoryHotkey();
    const controller = createHotkeyController(
      hotkey,
      createMemoryHotkeyPreferences(),
      { onPress: () => undefined },
    );
    await controller.ready;

    expect(controller.getState()).toEqual({
      shortcut: DEFAULT_SHORTCUT,
      registered: true,
      error: null,
    });
    expect(hotkey.registered()).toEqual([DEFAULT_SHORTCUT]);
    controller.dispose();
  });

  it("swaps the registration, persists it and stops the old shortcut", async () => {
    const hotkey = createMemoryHotkey();
    const preferences = createMemoryHotkeyPreferences();
    let presses = 0;
    const controller = createHotkeyController(hotkey, preferences, {
      onPress: () => {
        presses += 1;
      },
    });
    await controller.ready;

    await expect(controller.setShortcut("Control+Alt+K")).resolves.toBe(true);

    expect(controller.getState()).toEqual({
      shortcut: "Control+Alt+K",
      registered: true,
      error: null,
    });
    expect(preferences.read()).toBe("Control+Alt+K");
    expect(hotkey.registered()).toEqual(["Control+Alt+K"]);

    hotkey.trigger(DEFAULT_SHORTCUT);
    expect(presses).toBe(0);
    hotkey.trigger("Control+Alt+K");
    expect(presses).toBe(1);
    controller.dispose();
  });

  it("restores a saved shortcut on startup", async () => {
    const hotkey = createMemoryHotkey();
    const controller = createHotkeyController(
      hotkey,
      createMemoryHotkeyPreferences("Control+Alt+N"),
      { onPress: () => undefined },
    );
    await controller.ready;

    expect(controller.getState().shortcut).toBe("Control+Alt+N");
    expect(hotkey.registered()).toEqual(["Control+Alt+N"]);
    controller.dispose();
  });

  it("keeps the old shortcut active when a new one collides", async () => {
    const hotkey = createMemoryHotkey({ taken: ["Control+Alt+K"] });
    const preferences = createMemoryHotkeyPreferences();
    let presses = 0;
    const controller = createHotkeyController(hotkey, preferences, {
      onPress: () => {
        presses += 1;
      },
    });
    await controller.ready;

    await expect(controller.setShortcut("Control+Alt+K")).resolves.toBe(false);

    expect(controller.getState().shortcut).toBe(DEFAULT_SHORTCUT);
    expect(controller.getState().registered).toBe(true);
    expect(controller.getState().error).not.toBeNull();
    expect(preferences.read()).toBeNull();
    expect(hotkey.registered()).toEqual([DEFAULT_SHORTCUT]);
    hotkey.trigger(DEFAULT_SHORTCUT);
    expect(presses).toBe(1);
    controller.dispose();
  });

  it("reports a colliding saved shortcut instead of failing silently", async () => {
    const hotkey = createMemoryHotkey({ taken: ["Control+Alt+K"] });
    const controller = createHotkeyController(
      hotkey,
      createMemoryHotkeyPreferences("Control+Alt+K"),
      { onPress: () => undefined },
    );
    await controller.ready;

    expect(controller.getState()).toMatchObject({
      shortcut: "Control+Alt+K",
      registered: false,
    });
    expect(controller.getState().error).not.toBeNull();

    await expect(controller.setShortcut("Control+Shift+P")).resolves.toBe(true);
    expect(controller.getState().registered).toBe(true);
    controller.dispose();
  });

  it("rejects an unusable combination without dropping the active shortcut", async () => {
    const hotkey = createMemoryHotkey();
    const controller = createHotkeyController(
      hotkey,
      createMemoryHotkeyPreferences(),
      { onPress: () => undefined },
    );
    await controller.ready;

    await expect(controller.setShortcut("Shift+A")).resolves.toBe(false);
    expect(controller.getState().shortcut).toBe(DEFAULT_SHORTCUT);
    expect(controller.getState().registered).toBe(true);
    expect(controller.getState().error).not.toBeNull();
    controller.dispose();
  });

  it("unregisters the shortcut on dispose", async () => {
    const hotkey = createMemoryHotkey();
    const controller = createHotkeyController(
      hotkey,
      createMemoryHotkeyPreferences(),
      { onPress: () => undefined },
    );
    await controller.ready;

    controller.dispose();
    await settle();
    expect(hotkey.registered()).toEqual([]);
  });
});
