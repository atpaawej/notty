/**
 * Private: the ProseMirror safety net for transient image sources.
 *
 * WebKitGTK can insert an in-memory `blob:` image directly into the document
 * without a useful clipboard payload. This watcher notices any image whose
 * source is `blob:` or `data:`, persists the bytes through the attachment
 * saver, and rewrites the node to the durable vault-relative path.
 */
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  isTransientImageSource,
  storeTransientImage,
  type FetchImage,
  type SaveImage,
} from "./image-intake";

interface TransientImage {
  readonly source: string;
}

const transientImagesIn = (doc: ProseMirrorNode): TransientImage[] => {
  const found: TransientImage[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "image") return true;
    const source = node.attrs.src;
    if (typeof source === "string" && isTransientImageSource(source)) {
      found.push({ source });
    }
    return true;
  });
  return found;
};

/** Rewrite every node still using `source`; positions are read fresh. */
const replaceTransientSource = (
  view: EditorView,
  source: string,
  path: string,
): void => {
  const transaction = view.state.tr;
  let changed = false;
  view.state.doc.descendants((node, position) => {
    if (node.type.name !== "image" || node.attrs.src !== source) return true;
    transaction.setNodeAttribute(position, "src", path);
    changed = true;
    return true;
  });
  if (!changed) return;
  // Persisting is bookkeeping, not an edit the user made; folding it into the
  // same undo step as the paste avoids leaving a blob URL behind on undo.
  transaction.setMeta("addToHistory", false);
  view.dispatch(transaction);
};

/**
 * The extension reads `saveImage` lazily because the editor instance is built
 * once per note while the prop comes from React and may change between renders.
 */
export const createTransientImageExtension = (
  getSaveImage: () => SaveImage | undefined,
  fetchImage?: FetchImage,
) =>
  Extension.create({
    name: "transientImagePersistence",

    addProseMirrorPlugins() {
      let view: EditorView | null = null;
      const pending = new Set<string>();

      const scan = (): void => {
        if (view === null) return;
        const saveImage = getSaveImage();
        if (saveImage === undefined) return;

        for (const image of transientImagesIn(view.state.doc)) {
          if (pending.has(image.source)) continue;
          pending.add(image.source);
          void storeTransientImage(image.source, saveImage, fetchImage)
            .then((stored) => {
              if (view !== null) {
                replaceTransientSource(view, image.source, stored.path);
              }
            })
            .catch((cause: unknown) => {
              console.warn("Notty could not persist a transient image", cause);
            })
            .finally(() => {
              pending.delete(image.source);
            });
        }
      };

      return [
        new Plugin({
          view(editorView) {
            view = editorView;
            // Let the initial document render and its blob URL settle first.
            queueMicrotask(scan);
            return {
              destroy() {
                view = null;
              },
            };
          },
          appendTransaction() {
            scan();
            return null;
          },
        }),
      ];
    },
  });
