/**
 * Browser-side production wiring: one composed Layer for the WebView.
 *
 * The Tauri vault adapter supplies the location and filesystem; the Tauri
 * note-index adapter adds SQLite. The rest of the app sees only `NoteStore`
 * and the attachment intake handed to the editor.
 */
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { ClipboardImageReader } from "./modules/editor";
import {
  browserHotkeyPreferences,
  createHotkeyController,
  GlobalHotkey,
  hotkeyTauriLayer,
  type HotkeyController,
} from "./modules/hotkey";
import { ATTACHMENTS_DIRECTORY } from "./modules/note-file";
import {
  NoteIndex,
  noteIndexTauriLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "./modules/note-index";
import {
  createUpdater,
  UpdaterSeam,
  updaterTauriLayer,
  type UpdaterController,
} from "./modules/updater";
import {
  Vault,
  vaultTauriLayer,
  type VaultError,
  type VaultShape,
} from "./modules/vault";
import type { NoteStore, WorkspaceAttachments } from "./modules/workspace";
import { seedWelcomeNotes } from "./welcome-notes";

const vaultLayer = vaultTauriLayer;
const indexLayer = noteIndexTauriLayer.pipe(Layer.provide(vaultLayer));
const runtime = ManagedRuntime.make(Layer.merge(indexLayer, vaultLayer));
const hotkeyRuntime = ManagedRuntime.make(hotkeyTauriLayer);
const updaterRuntime = ManagedRuntime.make(updaterTauriLayer);

const withIndex = <A>(
  run: (index: NoteIndexShape) => Effect.Effect<A, NoteIndexError>,
): Promise<A> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return yield* run(index);
    }),
  );

const withVault = <A>(
  run: (vault: VaultShape) => Effect.Effect<A, VaultError>,
): Promise<A> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault;
      return yield* run(vault);
    }),
  );

// A folder is a directory. Renaming or deleting one moves note files, so the
// index is rebuilt afterwards and the files stay authoritative.
const folderChanged = async (): Promise<void> => {
  await withIndex((index) => index.rebuild());
};

export const noteStore: NoteStore = {
  list: (options) => withIndex((index) => index.list(options)),
  get: (id) => withIndex((index) => index.get(id)),
  save: (note, folder) => withIndex((index) => index.save(note, folder)),
  search: (query, limit) => withIndex((index) => index.search(query, limit)),
  listFolders: () =>
    withVault((vault) =>
      Effect.gen(function* () {
        // On first launch the vault may not exist yet; listing must not race
        // the index's own ensure.
        yield* vault.ensure();
        return yield* vault.listFolders();
      }),
    ),
  createFolder: async (folder) => {
    await withVault((vault) => vault.createFolder(folder));
  },
  renameFolder: async (folder, nextFolder) => {
    await withVault((vault) => vault.renameFolder(folder, nextFolder));
    await folderChanged();
  },
  deleteFolder: async (folder) => {
    await withVault((vault) => vault.deleteFolder(folder));
    await folderChanged();
  },
  listTrash: () => withIndex((index) => index.listTrash()),
  trashNote: async (id) => {
    await withIndex((index) => index.trash(id));
  },
  restoreNote: (id) => withIndex((index) => index.restore(id)),
  purgeNote: async (id) => {
    await withIndex((index) => index.purge(id));
  },
};

let vaultRoot = "";

/**
 * Production adapter for the native clipboard seam. Linux WebKitGTK often
 * delivers an empty clipboard payload for screenshots, so the paste handler
 * falls back to the OS clipboard and receives PNG bytes from here. Outside
 * Tauri, or when the clipboard holds no image, this is a quiet stub.
 */
const readClipboardImage: ClipboardImageReader = async () => {
  if (!isTauri()) return null;

  let image: Awaited<ReturnType<typeof readImage>> | null = null;
  try {
    image = await readImage();
    const [{ width, height }, rgba] = await Promise.all([
      image.size(),
      image.rgba(),
    ]);
    if (width <= 0 || height <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return null;

    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (blob === null) return null;

    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      name: "pasted-image.png",
      mimeType: "image/png",
    };
  } catch {
    // Text on the clipboard is the common case; readImage rejects for it.
    return null;
  } finally {
    if (image !== null) {
      await image.close().catch(() => undefined);
    }
  }
};

const attachments: WorkspaceAttachments = {
  readClipboardImage,
  saveImage: async (upload) => {
    const saved = await withVault((vault) =>
      vault.saveAttachment({
        bytes: upload.bytes,
        name: upload.name,
        mimeType: upload.mimeType,
      }),
    );
    return { path: saved.path, alt: saved.name };
  },
  // Only vault-relative attachment references are rewritten; external image
  // URLs in a note are left alone.
  imageSrc: (path) =>
    path.startsWith(`${ATTACHMENTS_DIRECTORY}/`)
      ? convertFileSrc(`${vaultRoot}/${path}`)
      : path,
};

/** Raise the window even when it is behind another app or minimised. */
const focusMainWindow = async (): Promise<void> => {
  if (!isTauri()) return;
  const window = getCurrentWindow();
  const quietly = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch {
      // A no-op state (already visible, not minimised) must not stop the
      // remaining raise steps.
    }
  };
  try {
    await quietly(() => window.unminimize());
    await quietly(() => window.show());
    await window.setFocus();
  } catch (cause) {
    console.warn("Notty could not raise its window", cause);
  }
};

/** Resolve the vault location once, before the UI needs image URLs. */
export interface AppRuntime {
  readonly store: NoteStore;
  readonly attachments: WorkspaceAttachments;
  readonly hotkey: HotkeyController;
  readonly updater: UpdaterController;
}

export const initializeRuntime = async (): Promise<AppRuntime> => {
  vaultRoot = await runtime.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault;
      const paths = yield* vault.location();
      return paths.root;
    }),
  );

  // First launch only. A failed seed must never stop the app from opening;
  // the marker is written last, so the next launch tries again.
  try {
    await runtime.runPromise(seedWelcomeNotes());
  } catch (cause) {
    console.warn("Notty could not seed the welcome notes", cause);
  }

  const hotkeyService = await hotkeyRuntime.runPromise(
    Effect.gen(function* () {
      return yield* GlobalHotkey;
    }),
  );
  const hotkey = createHotkeyController(
    hotkeyService,
    browserHotkeyPreferences,
    { onPress: focusMainWindow },
  );
  await hotkey.ready;

  // Update work starts after the window can accept input. The first check is
  // deliberately delayed so it never competes with capture.
  const updaterSeam = await updaterRuntime.runPromise(
    Effect.gen(function* () {
      return yield* UpdaterSeam;
    }),
  );
  const updater = createUpdater(updaterSeam, {
    autoCheck: true,
    autoDownload: true,
    initialDelayMs: 8_000,
  });

  return { store: noteStore, attachments, hotkey, updater };
};
