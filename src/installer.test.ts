import { execFileSync, spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../install.sh", import.meta.url));

const tempRoots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "notty-installer-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("user-space installer", () => {
  it("unpacks, links the CLI and registers desktop assets", async () => {
    const root = await makeRoot();
    const home = join(root, "home");
    const source = join(root, "source");
    const release = join(source, "notty-v9.9.9-linux-x86_64");

    await mkdir(join(release, "icons"), { recursive: true });
    await writeFile(join(release, "notty-desktop"), "#!/bin/sh\n");
    await writeFile(join(release, "notty"), "#!/bin/sh\n");
    const icon = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    for (const name of [
      "32x32.png",
      "128x128.png",
      "256x256.png",
      "512x512.png",
    ]) {
      await writeFile(join(release, "icons", name), icon);
    }

    const tarball = join(root, "notty.tar.gz");
    execFileSync("tar", [
      "-czf",
      tarball,
      "-C",
      source,
      "notty-v9.9.9-linux-x86_64",
    ]);

    const result = spawnSync("sh", [script], {
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_BIN_HOME: join(home, ".local", "bin"),
        NOTTY_VERSION: "v9.9.9",
        NOTTY_TARBALL: tarball,
      },
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const appDirectory = join(home, ".local", "share", "notty");
    await expect(
      readFile(join(appDirectory, "notty-desktop"), "utf8"),
    ).resolves.toContain("#!/bin/sh");

    const command = join(home, ".local", "bin", "notty");
    expect((await lstat(command)).isSymbolicLink()).toBe(true);
    expect(await readlink(command)).toBe(join(appDirectory, "notty"));

    const desktopFile = await readFile(
      join(home, ".local", "share", "applications", "notty.desktop"),
      "utf8",
    );
    expect(desktopFile).toContain(
      `Exec="${join(appDirectory, "notty-desktop")}"`,
    );
    expect(desktopFile).toContain("Icon=notty");

    for (const size of [32, 128, 256, 512]) {
      const path = join(
        home,
        ".local",
        "share",
        "icons",
        "hicolor",
        `${size}x${size}`,
        "apps",
        "notty.png",
      );
      await expect(readFile(path)).resolves.toHaveLength(icon.length);
    }
  });
});
