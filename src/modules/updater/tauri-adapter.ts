/**
 * Production adapter for the Tauri WebView.
 *
 * GitHub is the only network endpoint. The tarball is downloaded and
 * decompressed in the WebView, unpacked into a temporary directory, and only
 * then handed to the Rust shell for an atomic copy into the installation
 * directory. A read-only install never reaches the staging step.
 */
import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import {
  mkdir,
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { Effect, Layer } from "effect";
import { version as packageVersion } from "../../../package.json";
import {
  GITHUB_LATEST_RELEASE_URL,
  UpdaterError,
  UpdaterSeam,
  type UpdateRelease,
  type UpdaterInstallation,
  type UpdaterSeamShape,
} from "./service";
import { parseTar, stripReleaseRoot } from "./tar";

interface UpdaterInfo {
  readonly version: string;
  readonly installDir: string;
  readonly writable: boolean;
  readonly userSpace: boolean;
}

interface GitHubAsset {
  readonly name?: unknown;
  readonly browser_download_url?: unknown;
}

interface GitHubRelease {
  readonly tag_name?: unknown;
  readonly body?: unknown;
  readonly html_url?: unknown;
  readonly assets?: ReadonlyArray<GitHubAsset>;
}

const error = (operation: UpdaterError["operation"], cause: unknown): UpdaterError =>
  new UpdaterError({ operation, cause });

const readInfo = async (): Promise<UpdaterInfo> => {
  try {
    return await invoke<UpdaterInfo>("updater_info");
  } catch (cause) {
    // Browser-only `vite dev` has no Rust shell. It can still show the
    // current version, but it must never pretend it can update itself.
    return {
      version: packageVersion,
      installDir: "",
      writable: false,
      userSpace: false,
    };
  }
};

const isLinuxAsset = (name: string): boolean =>
  /^notty-.*-linux-(x86_64|aarch64)\.tar\.gz$/.test(name);

const pickAsset = (
  assets: ReadonlyArray<GitHubAsset> | undefined,
): string | null => {
  const matches = (assets ?? []).filter(
    (asset): asset is { name: string; browser_download_url: string } =>
      typeof asset.name === "string" &&
      typeof asset.browser_download_url === "string" &&
      isLinuxAsset(asset.name),
  );
  const x86 = matches.find((asset) => asset.name.includes("x86_64"));
  return (x86 ?? matches[0])?.browser_download_url ?? null;
};

const fetchLatestRelease = async (): Promise<UpdateRelease | null> => {
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw error(
      "check",
      new Error(`GitHub Releases returned ${response.status}`),
    );
  }

  const payload = (await response.json()) as GitHubRelease;
  if (typeof payload.tag_name !== "string") {
    throw error("check", new Error("The release feed had no tag name"));
  }

  const version = payload.tag_name.replace(/^v/i, "");
  return {
    version,
    notes: typeof payload.body === "string" ? payload.body : "",
    releaseUrl:
      typeof payload.html_url === "string"
        ? payload.html_url
        : `https://github.com/atpaawej/notty/releases/tag/v${version}`,
    downloadUrl: pickAsset(payload.assets),
  };
};

const download = async (
  url: string,
  onProgress: (progress: number) => void,
): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw error(
      "download",
      new Error(`The update download returned ${response.status}`),
    );
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  if (response.body === null) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress(1);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    chunks.push(value);
    received += value.byteLength;
    onProgress(total > 0 ? Math.min(0.9, (received / total) * 0.9) : 0.5);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

interface DecompressionStreamConstructor {
  new (format: string): TransformStream<Uint8Array, Uint8Array>;
}

const gunzip = async (compressed: Uint8Array): Promise<Uint8Array> => {
  const Decompression = (
    globalThis as unknown as {
      DecompressionStream?: DecompressionStreamConstructor;
    }
  ).DecompressionStream;
  if (Decompression === undefined) {
    throw error("stage", new Error("This WebView cannot decompress updates"));
  }

  const owned = new Uint8Array(compressed);
  const stream = new Blob([owned.buffer])
    .stream()
    .pipeThrough(new Decompression("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const stageArchive = async (
  archive: Uint8Array,
  installation: UpdaterInfo,
  onProgress: (progress: number) => void,
): Promise<void> => {
  const root = await tempDir();
  const staging = await join(root, `notty-update-${Date.now()}`);

  try {
    await mkdir(staging, { recursive: true });
    const entries = stripReleaseRoot(parseTar(archive));
    if (entries.length === 0) {
      throw error("stage", new Error("The update archive was empty"));
    }

    for (const entry of entries) {
      const target = await join(staging, entry.name);
      if (entry.kind === "directory") {
        await mkdir(target, { recursive: true });
        continue;
      }
      if (entry.bytes === null) continue;
      const parent = target.slice(0, target.lastIndexOf("/"));
      if (parent.length > 0) await mkdir(parent, { recursive: true });
      await writeFile(target, entry.bytes);
    }

    onProgress(0.95);
    await invoke<number>("updater_apply_stage", {
      staging,
      installDir: installation.installDir,
    });
    onProgress(1);
  } finally {
    try {
      await remove(staging, { recursive: true });
    } catch {
      // The Rust copy removes the staging tree on success. A failed run may
      // leave it behind; the next update uses a fresh directory.
    }
  }
};

const tauriUpdater: UpdaterSeamShape = {
  currentVersion: () =>
    Effect.tryPromise({
      try: async () => (await readInfo()).version,
      catch: (cause) => error("currentVersion", cause),
    }),
  installation: () =>
    Effect.tryPromise({
      try: async (): Promise<UpdaterInstallation> => {
        const info = await readInfo();
        return {
          version: info.version,
          installDir: info.installDir,
          writable: info.writable,
          userSpace: info.userSpace,
        };
      },
      catch: (cause) => error("installation", cause),
    }),
  latestRelease: () =>
    Effect.tryPromise({
      try: fetchLatestRelease,
      catch: (cause) => error("check", cause),
    }),
  downloadAndStage: (release, onProgress) =>
    Effect.tryPromise({
      try: async () => {
        if (release.downloadUrl === null) {
          throw error(
            "download",
            new Error("This release has no Linux tarball"),
          );
        }
        const info = await readInfo();
        if (!info.writable) {
          throw error(
            "download",
            new Error("The installation directory is read-only"),
          );
        }
        const compressed = await download(release.downloadUrl, onProgress);
        onProgress(0.92);
        const archive = await gunzip(compressed);
        await stageArchive(archive, info, onProgress);
      },
      catch: (cause) => error("stage", cause),
    }),
  restart: () =>
    Effect.tryPromise({
      try: () => invoke<void>("updater_restart"),
      catch: (cause) => error("restart", cause),
    }),
};

export const updaterTauriLayer = Layer.succeed(UpdaterSeam, tauriUpdater);
