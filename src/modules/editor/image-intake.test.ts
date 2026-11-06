import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it, vi } from "vitest";
import { editorExtensions } from "./extensions";
import {
  persistIntakeUploads,
  planImageIntake,
  rewriteTransientImageSources,
  type ImageTransfer,
  type ImageUpload,
} from "./image-intake";
import { normalizeMarkdown } from "./index";

const transfer = (overrides: Partial<ImageTransfer> = {}): ImageTransfer => ({
  files: [],
  items: [],
  types: [],
  getData: () => "",
  ...overrides,
});

const pngBlob = (bytes: ReadonlyArray<number>): Blob =>
  new Blob([new Uint8Array(bytes)], { type: "image/png" });

const ATTACHMENT = "attachments/3b1e7f0e-6a2d-4d1a-9a0e-1b2c3d4e5f60.png";

describe("clipboard image intake", () => {
  it("stores a pasted image file and inserts its attachment path", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
      type: "image/png",
    });
    const plan = planImageIntake(
      transfer({ files: [file], types: ["Files"] }),
    );
    const saved: ImageUpload[] = [];

    const stored = await persistIntakeUploads(plan.uploads, async (upload) => {
      saved.push(upload);
      return { path: ATTACHMENT, alt: upload.name };
    });

    expect(plan.handled).toBe(true);
    expect(plan.external).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.mimeType).toBe("image/png");
    expect(saved[0]?.bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(stored).toEqual([{ path: ATTACHMENT, alt: "screenshot.png" }]);
  });

  it("reads the native clipboard when the DOM payload is completely empty", async () => {
    const readClipboardImage = vi.fn(async () => ({
      bytes: new Uint8Array([9, 8, 7]),
      name: "pasted-image.png",
      mimeType: "image/png",
    }));

    const plan = planImageIntake(transfer(), {
      readClipboardImage,
      allowNativeClipboard: true,
    });

    expect(plan.handled).toBe(true);
    await expect(
      persistIntakeUploads(plan.uploads, async (upload) => ({
        path: ATTACHMENT,
        alt: upload.name,
      })),
    ).resolves.toEqual([{ path: ATTACHMENT, alt: "pasted-image.png" }]);
    expect(readClipboardImage).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary text paste untouched and does not read the clipboard", async () => {
    const readClipboardImage = vi.fn(async () => null);

    const plan = planImageIntake(
      transfer({ types: ["text/plain"], getData: () => "hello" }),
      { readClipboardImage, allowNativeClipboard: true },
    );

    expect(plan.handled).toBe(false);
    await expect(plan.uploads).resolves.toEqual([]);
    expect(readClipboardImage).not.toHaveBeenCalled();
  });

  it("never falls back to the native clipboard for a drag", async () => {
    const readClipboardImage = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      name: "pasted-image.png",
      mimeType: "image/png",
    }));

    const plan = planImageIntake(transfer(), {
      readClipboardImage,
      allowNativeClipboard: false,
    });

    expect(plan.handled).toBe(false);
    expect(readClipboardImage).not.toHaveBeenCalled();
  });

  it("fetches transient HTML images into durable uploads", async () => {
    const fetchImage = vi.fn(async () => pngBlob([4, 5, 6]));
    const plan = planImageIntake(
      transfer({
        types: ["text/html"],
        getData: () =>
          '<img src="blob:tauri://localhost/5f0a" alt="screenshot">',
      }),
      { fetchImage },
    );

    const stored = await persistIntakeUploads(plan.uploads, async (upload) => ({
      path: ATTACHMENT,
      alt: upload.name,
    }));

    expect(plan.handled).toBe(true);
    expect(fetchImage).toHaveBeenCalledWith("blob:tauri://localhost/5f0a");
    expect(stored).toEqual([{ path: ATTACHMENT, alt: "pasted-image.png" }]);
  });

  it("keeps external HTML image URLs portable", () => {
    const plan = planImageIntake(
      transfer({
        types: ["text/html"],
        getData: () => '<img src="https://example.com/photo.jpg">',
      }),
    );

    expect(plan.handled).toBe(true);
    expect(plan.external).toEqual(["https://example.com/photo.jpg"]);
  });
});

describe("transient image persistence", () => {
  const manager = new MarkdownManager({
    extensions: [...editorExtensions],
  });

  it("rewrites blob and data image sources to attachment paths", async () => {
    const doc = manager.parse(
      [
        "![blob screenshot](blob:tauri://localhost/abc)",
        "",
        "![inline pixel](data:image/png;base64,AAAA)",
      ].join("\n"),
    );
    let next = 0;
    const paths = [
      "attachments/first.png",
      "attachments/second.png",
    ];

    const rewritten = await rewriteTransientImageSources(
      doc,
      async (upload) => {
        const path = paths[next] ?? `attachments/${next}.png`;
        next += 1;
        return { path, alt: upload.name };
      },
      async () => pngBlob([1, 2, 3]),
    );
    const markdown = manager.serialize(rewritten);

    expect(markdown).toContain("attachments/first.png");
    expect(markdown).toContain("attachments/second.png");
    expect(markdown).not.toMatch(/(?:blob|data):/i);
  });

  it("never serializes a transient URL when persistence has not run", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const saved = normalizeMarkdown("![shot](blob:tauri://localhost/abc)");

    expect(saved).not.toMatch(/blob:/i);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still serializes durable attachment and external image sources", () => {
    const durable =
      "![receipt](attachments/3b1e7f0e-6a2d-4d1a-9a0e-1b2c3d4e5f60.png)\n\n![web](https://example.com/photo.png)";

    expect(normalizeMarkdown(durable)).toBe(durable);
  });
});
