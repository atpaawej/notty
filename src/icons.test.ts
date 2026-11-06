import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const icons = fileURLToPath(new URL("../src-tauri/icons", import.meta.url));

const pngSize = (bytes: Uint8Array): { width: number; height: number } => ({
  width:
    ((bytes[16] ?? 0) << 24) |
    ((bytes[17] ?? 0) << 16) |
    ((bytes[18] ?? 0) << 8) |
    (bytes[19] ?? 0),
  height:
    ((bytes[20] ?? 0) << 24) |
    ((bytes[21] ?? 0) << 16) |
    ((bytes[22] ?? 0) << 8) |
    (bytes[23] ?? 0),
});

describe("branded icon suite", () => {
  it.each([
    ["32x32.png", 32],
    ["128x128.png", 128],
    ["256x256.png", 256],
    ["512x512.png", 512],
  ])("%s is a non-empty %ipx PNG", async (name, size) => {
    const path = join(icons, name);
    const bytes = await readFile(path);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(pngSize(bytes)).toEqual({ width: size, height: size });
  });

  it.each(["icon.ico", "icon.icns"])("%s is non-empty", async (name) => {
    const info = await stat(join(icons, name));
    expect(info.size).toBeGreaterThan(0);
  });
});
