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

const checklist = [
  "- [ ] Buy milk",
  "- [x] Buy eggs",
  "- [ ] Bake bread",
].join("\n");

const table = [
  "| Item | Quantity |",
  "| --- | ---: |",
  "| Milk | 2 |",
  "| Eggs | 12 |",
].join("\n");

const mixed = ["Before.", "", checklist, "", table, "", "After."].join("\n");

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

describe("Checklist round-trip", () => {
  it("preserves unchecked and checked state", () => {
    expect(normalizeMarkdown(checklist)).toBe(checklist);
  });

  it("keeps checked state through save and reload", () => {
    const saved = normalizeMarkdown(checklist);
    const reloaded = normalizeMarkdown(saved);

    expect(reloaded).toBe(saved);
    expect(reloaded).toContain("- [ ] Buy milk");
    expect(reloaded).toContain("- [x] Buy eggs");
    expect(reloaded).toContain("- [ ] Bake bread");
  });

  it("keeps mixed checked and unchecked state", () => {
    const edited = ["- [x] Ticked", "- [ ] Unticked"].join("\n");

    expect(normalizeMarkdown(normalizeMarkdown(edited))).toBe(edited);
  });
});

describe("Table round-trip", () => {
  it("preserves header, rows, content and alignment", () => {
    const saved = normalizeMarkdown(table);

    expect(saved).toContain("| Item | Quantity |");
    expect(saved).toMatch(/\| -+ \| -+: \|/);
    expect(saved).toContain("| Milk | 2");
    expect(saved).toContain("| Eggs | 12");
  });

  it("keeps table content through save and reload", () => {
    const saved = normalizeMarkdown(table);
    const reloaded = normalizeMarkdown(saved);

    expect(reloaded).toBe(saved);
  });

  it("keeps formatting inside table cells", () => {
    const formatted = [
      "| Name | Note |",
      "| --- | --- |",
      "| **Milk** | *cold* |",
    ].join("\n");
    const saved = normalizeMarkdown(formatted);

    expect(saved).toContain("**Milk**");
    expect(saved).toContain("*cold*");
    expect(normalizeMarkdown(saved)).toBe(saved);
  });

  it("keeps adjacent tables from drifting apart", () => {
    const adjacent = [table, "", "| Name | Note |", "| --- | --- |", "| Tea | hot |"].join(
      "\n",
    );
    const saved = normalizeMarkdown(adjacent);

    expect(saved).toContain("| Milk | 2");
    expect(saved).toMatch(/\| Tea\s+\| hot\s+\|/);
    expect(normalizeMarkdown(saved)).toBe(saved);
    expect(normalizeMarkdown(normalizeMarkdown(saved))).toBe(saved);
  });
});

describe("Checklist and table together", () => {
  it("round-trips both through serialize(parse(x))", () => {
    const once = normalizeMarkdown(mixed);

    expect(once).toContain("- [x] Buy eggs");
    expect(once).toContain("| Milk | 2");
    expect(normalizeMarkdown(once)).toBe(once);
  });

  it("round-trips both through parse(serialize(x))", () => {
    // A canonical document parsed and serialized again must not drift.
    const canonical = normalizeMarkdown(mixed);
    const reparsed = normalizeMarkdown(canonical);

    expect(reparsed).toBe(canonical);
    expect(normalizeMarkdown(reparsed)).toBe(reparsed);
  });
});

