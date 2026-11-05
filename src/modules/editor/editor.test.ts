import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "./index";

/** Markdown covering every inline and block object #6 ships. */
const supported = [
  "# Heading one",
  "",
  "Some **bold**, some *italic*, and some plain text.",
  "",
  "- unordered",
  "- list",
  "",
  "1. ordered",
  "2. list",
].join("\n");

describe("Markdown round-trip", () => {
  it("preserves text, bold, italic, headings and lists", () => {
    expect(normalizeMarkdown(supported)).toBe(supported);
  });

  it("is idempotent", () => {
    const once = normalizeMarkdown(supported);

    expect(normalizeMarkdown(once)).toBe(once);
  });

  it("serializes an empty document to an empty body", () => {
    expect(normalizeMarkdown("")).toBe("");
  });

  it("keeps blank lines between blocks", () => {
    const spaced = "First paragraph.\n\nSecond paragraph.";

    expect(normalizeMarkdown(spaced)).toBe(spaced);
  });

  it("supports nested inline formatting", () => {
    const nested = "A **bold *and italic* phrase**.";

    expect(normalizeMarkdown(nested)).toBe(nested);
  });
});
