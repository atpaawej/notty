import { describe, expect, it } from "vitest";
import {
  attachmentReference,
  deriveAutoTitle,
  imageReferences,
  isAttachmentReference,
  isInlineImageData,
  parse,
  serialize,
  type Note,
} from "./index";

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "0f9c2b7e-4d31-4a58-9c45-3d44f6d0a8b1",
  title: "Groceries",
  created: "2026-11-05T09:14:00Z",
  modified: "2026-11-05T09:31:12Z",
  pinned: false,
  archived: false,
  body: "Milk, eggs, the good bread.",
  ...overrides,
});

/** Markdown covering every object the v1 editor supports. */
const supportedMarkdown = [
  "# Heading",
  "",
  "Some **bold**, some *italic*, and some plain text.",
  "",
  "- unordered",
  "- list",
  "",
  "1. ordered",
  "2. list",
  "",
  "- [ ] unchecked",
  "- [x] checked",
  "",
  "| Item | Quantity |",
  "| --- | ---: |",
  "| Milk | 2 |",
  "",
  "![receipt](attachments/3b1e7f0e-6a2d-4d1a-9a0e-1b2c3d4e5f60.png)",
  "",
].join("\n");

const canonicalFile = (body: string): string =>
  [
    "---",
    "id: 0f9c2b7e-4d31-4a58-9c45-3d44f6d0a8b1",
    "title: Groceries",
    "created: 2026-11-05T09:14:00Z",
    "modified: 2026-11-05T09:31:12Z",
    "pinned: false",
    "archived: false",
    "---",
    "",
    body,
  ].join("\n");

describe("parse", () => {
  it("reads frontmatter and the Markdown body", () => {
    const parsed = parse(canonicalFile("Milk, eggs, the good bread."));

    expect(parsed).toEqual(note());
  });

  it("keeps a stored title instead of deriving one from the body", () => {
    const parsed = parse(
      canonicalFile("Completely different opening words in the body."),
    );

    expect(parsed.title).toBe("Groceries");
  });

  it("treats a file without frontmatter as a body-only note", () => {
    const parsed = parse("# Just a body\n\nNo frontmatter here.");

    expect(parsed.body).toBe("# Just a body\n\nNo frontmatter here.");
    expect(parsed.title).toBe("");
    expect(parsed.pinned).toBe(false);
  });

  it("normalises CRLF line endings", () => {
    const parsed = parse(
      canonicalFile("Line one\nLine two").replace(/\n/g, "\r\n"),
    );

    expect(parsed.body).toBe("Line one\nLine two");
  });

  it("does not invent an extra record when every key is known", () => {
    expect(parse(canonicalFile("body"))).not.toHaveProperty("extra");
  });
});

describe("serialize", () => {
  it("writes canonical frontmatter followed by the body", () => {
    expect(serialize(note())).toBe(canonicalFile("Milk, eggs, the good bread."));
  });

  it("writes an empty body for an empty document", () => {
    const output = serialize(note({ body: "" }));

    expect(output.endsWith("---\n")).toBe(true);
    expect(output).not.toContain("placeholder");
    expect(parse(output).body).toBe("");
  });

  it("quotes values that would otherwise change YAML meaning", () => {
    const tricky = note({
      title: 'A: "tricky" # title',
      body: "",
    });

    expect(parse(serialize(tricky)).title).toBe(tricky.title);
  });

  it("keeps leading blank lines in the body", () => {
    const spaced = note({ body: "\n\nStarts after a pause." });

    expect(parse(serialize(spaced)).body).toBe(spaced.body);
  });
});

describe("round-trip stability", () => {
  it("is stable for every supported Markdown node type", () => {
    const original = canonicalFile(supportedMarkdown);

    expect(serialize(parse(original))).toBe(original);
  });

  it("parse(serialize(note)) preserves every Note field", () => {
    const original = note({ body: supportedMarkdown });

    expect(parse(serialize(original))).toEqual(original);
  });

  it("serialize(parse(markdown)) is idempotent", () => {
    const once = serialize(parse(canonicalFile(supportedMarkdown)));
    const twice = serialize(parse(once));

    expect(twice).toBe(once);
  });

  it("survives a body that looks like frontmatter", () => {
    const original = note({
      body: "---\nnot: frontmatter\n---\n\nInside the body.",
    });

    expect(parse(serialize(original))).toEqual(original);
  });
});

describe("unknown frontmatter", () => {
  it("preserves unknown keys verbatim on write", () => {
    const source = [
      "---",
      "id: 0f9c2b7e-4d31-4a58-9c45-3d44f6d0a8b1",
      "title: Groceries",
      "created: 2026-11-05T09:14:00Z",
      "modified: 2026-11-05T09:31:12Z",
      "pinned: false",
      "archived: false",
      "colour: green",
      "nested:",
      "  future: field",
      "---",
      "",
      "Body",
    ].join("\n");

    const parsed = parse(source);
    const output = serialize(parsed);

    expect(parsed.extra).toEqual({
      colour: "green",
      nested: { future: "field" },
    });
    expect(output).toContain("colour: green");
    expect(output).toContain("nested:\n  future: field");
    expect(output).toBe(source);
  });

  it("writes newly added extra keys", () => {
    const output = serialize(
      note({ extra: { colour: "green", tags: ["a", "b"] } }),
    );

    expect(output).toContain("colour: green");
    expect(output).toContain("tags:\n  - a\n  - b");
  });

  it("round-trips scalar extra values", () => {
    const original = note({
      extra: {
        colour: "green",
        count: 3,
        private: true,
        missing: null,
      },
    });

    expect(parse(serialize(original))).toEqual(original);
  });
});

describe("auto-title", () => {
  const created = "2026-11-05T09:14:00Z";

  it("combines the creation date with the first body words", () => {
    expect(deriveAutoTitle(created, "Milk, eggs, the good bread.")).toBe(
      "2026-11-05 — Milk, eggs, the good bread.",
    );
  });

  it("limits the number of body words", () => {
    expect(
      deriveAutoTitle(created, "one two three four five six seven", {
        maxWords: 3,
      }),
    ).toBe("2026-11-05 — one two three");
  });

  it("accepts a Note-shaped value", () => {
    expect(deriveAutoTitle({ created, body: "First words of a note" })).toBe(
      "2026-11-05 — First words of a note",
    );
  });

  it("falls back to the date when the body has no words", () => {
    expect(deriveAutoTitle(created, "   \n  ")).toBe("2026-11-05");
  });

  it("accepts a Date and formats it as UTC", () => {
    expect(deriveAutoTitle(new Date("2026-11-05T23:30:00Z"), "Late note")).toBe(
      "2026-11-05 — Late note",
    );
  });

  it("is never used by parse", () => {
    const parsed = parse(canonicalFile("A body with words"));

    expect(parsed.title).toBe("Groceries");
    expect(parsed.title).not.toContain("A body");
  });
});

describe("image references", () => {
  it("extracts image references from Markdown", () => {
    expect(
      imageReferences(
        "Text\n\n![receipt](attachments/one.png)\n\n![alt](attachments/two.jpg \"title\")",
      ),
    ).toEqual(["attachments/one.png", "attachments/two.jpg"]);
  });

  it("builds vault-relative attachment references", () => {
    expect(attachmentReference("one.png")).toBe("attachments/one.png");
    expect(attachmentReference("./attachments/two.png")).toBe(
      "attachments/two.png",
    );
    expect(attachmentReference("/attachments/three.png")).toBe(
      "attachments/three.png",
    );
  });

  it("recognises relative attachment references and forbids inline data", () => {
    expect(isAttachmentReference("attachments/one.png")).toBe(true);
    expect(isAttachmentReference("/tmp/one.png")).toBe(false);
    expect(isAttachmentReference("https://example.test/one.png")).toBe(false);
    expect(isInlineImageData("data:image/png;base64,AAAA")).toBe(true);
    expect(isInlineImageData("attachments/one.png")).toBe(false);
  });

  it("keeps Markdown image nodes byte-stable", () => {
    const original = note({
      body: "![receipt](attachments/3b1e.png)",
    });

    expect(serialize(parse(serialize(original)))).toBe(serialize(original));
  });
});
