import { describe, expect, it } from "vitest";
import {
  compareVersions,
  createMemoryUpdater,
  createMemoryUpdaterSeam,
  createUpdater,
  isNewerVersion,
} from "./index";

describe("version comparison", () => {
  it("orders release versions numerically, not lexicographically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(isNewerVersion("v1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  it("sorts prereleases below their stable release", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
  });
});

describe("updater controller", () => {
  it("reports an available user-space update", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
      notes: "Faster capture",
    });

    await updater.check();

    expect(updater.getState()).toEqual({
      status: "Available",
      version: "0.3.0",
      notes: "Faster capture",
      isUserSpace: true,
    });
    expect(updater.seam.checkCount()).toBe(1);
    updater.dispose();
  });

  it("stages a download and restarts", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
    });
    await updater.check();
    await expect(updater.downloadAndStage()).resolves.toBe(true);

    expect(updater.getState()).toEqual({
      status: "ReadyToRestart",
      version: "0.3.0",
    });
    await expect(updater.restart()).resolves.toBe(true);
    expect(updater.seam.restartCount()).toBe(1);
    expect(updater.seam.stagedRelease()?.version).toBe("0.3.0");
    updater.dispose();
  });

  it("never stages a read-only system install", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
      isUserSpace: false,
    });
    await updater.check();

    expect(updater.getState()).toMatchObject({
      status: "Available",
      version: "0.3.0",
      isUserSpace: false,
    });
    await expect(updater.downloadAndStage()).resolves.toBe(false);
    expect(updater.seam.downloadCount()).toBe(0);
    updater.dispose();
  });

  it("turns a failed check into state instead of throwing", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      failCheck: "offline",
    });

    await expect(updater.check()).resolves.toBeUndefined();
    expect(updater.getState().status).toBe("Failed");
    updater.dispose();
  });

  it("turns a failed download into state and leaves the install alone", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
      failDownload: "connection reset",
    });
    await updater.check();
    await expect(updater.downloadAndStage()).resolves.toBe(false);

    expect(updater.getState().status).toBe("Failed");
    expect(updater.seam.stagedRelease()).toBeNull();
    updater.dispose();
  });

  it("shares one request between rapid checks", async () => {
    const seam = createMemoryUpdaterSeam({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
    });
    const updater = createUpdater(seam);

    await Promise.all([updater.check(), updater.check(), updater.check()]);

    expect(seam.checkCount()).toBe(1);
    updater.dispose();
  });

  it("dismisses without losing the staged update", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
    });
    await updater.check();
    await updater.downloadAndStage();
    updater.dismiss();

    expect(updater.isDismissed()).toBe(true);
    expect(updater.getState().status).toBe("ReadyToRestart");
    updater.dispose();
  });

  it("reports an up-to-date installation", async () => {
    const updater = createMemoryUpdater({
      currentVersion: "0.2.0",
      latestVersion: "0.2.0",
    });
    await updater.check();

    expect(updater.getState()).toMatchObject({
      status: "UpToDate",
      version: "0.2.0",
    });
    updater.dispose();
  });
});
