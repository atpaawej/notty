/**
 * Browser-side production wiring: one composed Layer for the WebView.
 *
 * The Tauri vault adapter supplies the location and filesystem; the Tauri
 * note-index adapter adds SQLite. The rest of the app sees only `NoteStore`
 * and the attachment intake handed to the editor.
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import { Effect, Layer, ManagedRuntime } from "effect";
import { ATTACHMENTS_DIRECTORY } from "./modules/note-file";
import {
  NoteIndex,
  noteIndexTauriLayer,
  type NoteIndexError,
  type NoteIndexShape,
} from "./modules/note-index";
import {
  Vault,
  vaultTauriLayer,
  type VaultError,
  type VaultShape,
} from "./modules/vault";
import type { NoteStore, WorkspaceAttachments } from "./modules/workspace";

const vaultLayer = vaultTauriLayer;
const indexLayer = noteIndexTauriLayer.pipe(Layer.provide(vaultLayer));
const runtime = ManagedRuntime.make(Layer.merge(indexLayer, vaultLayer));

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
};

let vaultRoot = "";

const attachments: WorkspaceAttachments = {
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

/** Resolve the vault location once, before the UI needs image URLs. */
export interface AppRuntime {
  readonly store: NoteStore;
  readonly attachments: WorkspaceAttachments;
}

export const initializeRuntime = async (): Promise<AppRuntime> => {
  vaultRoot = await runtime.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault;
      const paths = yield* vault.location();
      return paths.root;
    }),
  );
  return { store: noteStore, attachments };
};
