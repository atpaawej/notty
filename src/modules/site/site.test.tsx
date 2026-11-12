import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDemoState,
  isDemoChecked,
  selectDemoArchive,
  selectDemoFolder,
  selectedDemoNote,
  setDemoQuery,
  toggleDemoCheck,
  visibleDemoNotes,
} from "./demo-state";
import { Site } from "./index";

const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/atpaawej/notty/main/install.sh | sh";

const markup = renderToStaticMarkup(<Site />);

describe("landing page", () => {
  it("renders the three-column product demo in the hero", () => {
    expect(markup).toContain('data-testid="product-demo"');
    expect(markup).toContain('data-column="sidebar"');
    expect(markup).toContain('data-column="note-list"');
    expect(markup).toContain('data-column="editor"');
    expect(markup).toContain("Quick Capture");
    expect(markup).toContain("Search notes (FTS5");
    expect(markup).toContain("demo-dock note-editor-dock");
    expect(markup).toContain("attachments/7d1c9e4a.png");
  });

  it("shows the one-line installer in the hero and the install section", () => {
    expect(markup.split(INSTALL_COMMAND).length - 1).toBe(2);
  });

  it("renders four feature cards, each with its own raw SVG", () => {
    const features = Array.from(
      markup.matchAll(/data-feature="([^"]+)"/g),
      (match) => match[1],
    );
    expect(features).toEqual(["capture", "editor", "storage", "cli"]);
    expect(markup).toContain('id="feature-capture-title"');
    expect(markup).toContain('id="feature-editor-title"');
    expect(markup).toContain('id="feature-storage-title"');
    expect(markup).toContain('id="feature-cli-title"');
  });
});

describe("demo state", () => {
  it("starts on All Notes with the pinned note selected", () => {
    const state = createDemoState();
    expect(visibleDemoNotes(state).map((note) => note.id)).toEqual([
      "rfc-sync",
      "groceries",
      "weekly",
      "reading",
    ]);
    expect(selectedDemoNote(state)?.id).toBe("rfc-sync");
  });

  it("switches folder and keeps a visible note selected", () => {
    const state = selectDemoFolder(createDemoState(), "personal");
    expect(visibleDemoNotes(state).every((note) => note.folder === "personal")).toBe(
      true,
    );
    expect(selectedDemoNote(state)?.id).toBe("groceries");
  });

  it("switches to Archive and selects the archived note", () => {
    const state = selectDemoArchive(createDemoState());
    expect(visibleDemoNotes(state).map((note) => note.id)).toEqual(["release"]);
    expect(selectedDemoNote(state)?.id).toBe("release");
  });

  it("filters notes by the search query", () => {
    const state = setDemoQuery(createDemoState(), "wal");
    expect(visibleDemoNotes(state).map((note) => note.id)).toEqual(["rfc-sync"]);
  });

  it("toggles a circular checklist item", () => {
    const state = createDemoState();
    const note = selectedDemoNote(state);
    const item = note?.checklist[0];
    expect(note).not.toBeNull();
    expect(item).toBeDefined();
    if (note === null || item === undefined) return;

    expect(isDemoChecked(state, note, item)).toBe(true);
    const toggled = toggleDemoCheck(state, note, item);
    expect(isDemoChecked(toggled, note, item)).toBe(false);
    expect(isDemoChecked(toggleDemoCheck(toggled, note, item), note, item)).toBe(
      true,
    );
  });
});

describe("motion and type contract", () => {
  it("keeps the transition and reduced-motion rules discoverable", async () => {
    const css = await readFile(new URL("./site.css", import.meta.url), "utf8");
    expect(css).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1)");
    expect(css).toContain("transform: scale(0.97)");
    expect(css).toContain("clip-path: inset(0 100% 0 0)");
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.feature-svg \* \{\s*animation: none !important;/);
  });
});
