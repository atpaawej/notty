/**
 * Private: image intake shared by paste, drop, the file picker and the
 * transient-source safety net.
 *
 * This file owns the decision of where bytes come from (DOM transfer, HTML
 * image tags, or the native clipboard) but never decides where they are stored.
 * The caller supplies the vault-backed `SaveImage`.
 */
import type { JSONContent } from "@tiptap/core";

/** Bytes and metadata for one pasted or dropped image. */
export interface ImageUpload {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

/** Where the vault stored an image, and the alt text a new image starts with. */
export interface StoredImage {
  /** Vault-relative reference inserted into the Markdown body. */
  readonly path: string;
  readonly alt: string;
}

export type SaveImage = (upload: ImageUpload) => Promise<StoredImage>;

/**
 * Reads an image from the system clipboard. The Tauri composition root supplies
 * the native adapter; non-Tauri and test environments supply a stub that
 * resolves to `null`.
 */
export type ClipboardImageReader = () => Promise<ImageUpload | null>;

/** The structural part of a clipboard or drag transfer that intake needs. */
export interface ImageTransferItem {
  readonly kind: string;
  readonly type: string;
  getAsFile(): File | null;
}

export interface ImageTransfer {
  readonly files: ArrayLike<File>;
  readonly items: ArrayLike<ImageTransferItem>;
  readonly types: ReadonlyArray<string>;
  getData(format: string): string;
}

export type FetchImage = (source: string) => Promise<Blob>;

export interface ImageIntakeOptions {
  /** Native clipboard fallback, used only when the DOM payload is empty. */
  readonly readClipboardImage?: ClipboardImageReader;
  /** True for paste; drag-and-drop never reads the system clipboard. */
  readonly allowNativeClipboard?: boolean;
  /** Seam used by tests to stand in for fetching a blob or data URL. */
  readonly fetchImage?: FetchImage;
}

export interface ImageIntakePlan {
  /** True when the editor should swallow the paste or drop. */
  readonly handled: boolean;
  /** Image bytes that must be stored before their nodes are inserted. */
  readonly uploads: Promise<ReadonlyArray<ImageUpload>>;
  /** Portable http(s) sources inserted unchanged. */
  readonly external: ReadonlyArray<string>;
}

const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;

export const isImageFile = (file: File): boolean =>
  file.type.startsWith("image/") || IMAGE_FILE_PATTERN.test(file.name);

/** Blob and data URLs die with the webview, so they must become files. */
export const isTransientImageSource = (source: string): boolean =>
  /^(?:blob|data):/i.test(source);

const IMAGE_SRC_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Pull image sources out of clipboard or drag HTML without a DOM parser. */
export const imageSourcesInHtml = (html: string): string[] => {
  const sources: string[] = [];
  for (const match of html.matchAll(IMAGE_SRC_PATTERN)) {
    const source = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (source.length > 0) sources.push(source);
  }
  return sources;
};

const EXTENSIONS_BY_MIME: Readonly<Record<string, string>> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
};

const fallbackImageName = (mimeType: string): string =>
  `pasted-image${EXTENSIONS_BY_MIME[mimeType.toLowerCase()] ?? ".png"}`;

export const nameForSource = (source: string, mimeType: string): string => {
  if (/^data:/i.test(source)) return fallbackImageName(mimeType);
  const withoutQuery = source.split(/[?#]/)[0] ?? source;
  const name = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  return IMAGE_FILE_PATTERN.test(name) ? name : fallbackImageName(mimeType);
};

const mimeTypeForSource = (source: string): string | null => {
  const match = /^data:([^;,]+)/i.exec(source);
  return match?.[1]?.toLowerCase() ?? null;
};

/**
 * Clipboard and drag payloads expose files through `files` on most platforms
 * and only through `items` on some, so fall back rather than collect both.
 */
const imageFilesIn = (transfer: ImageTransfer | null): File[] => {
  if (transfer === null) return [];

  const files =
    transfer.files.length > 0
      ? Array.from(transfer.files)
      : Array.from(transfer.items)
          .filter(
            (item) =>
              item.kind === "file" &&
              (item.type.startsWith("image/") ||
                IMAGE_FILE_PATTERN.test(item.type)),
          )
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);

  return files.filter(isImageFile);
};

const uploadOfFile = async (file: File): Promise<ImageUpload> => {
  const mimeType = file.type.length > 0 ? file.type : "image/png";
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    name: file.name.length > 0 ? file.name : fallbackImageName(mimeType),
    mimeType,
  };
};

const settledUploads = async (
  uploads: ReadonlyArray<Promise<ImageUpload>>,
  warning: string,
): Promise<ReadonlyArray<ImageUpload>> => {
  const results = await Promise.allSettled(uploads);
  const ready: ImageUpload[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      ready.push(result.value);
    } else {
      console.warn(warning, result.reason);
    }
  }
  return ready;
};

/** Turn picked image files into uploads, preserving their names and types. */
export const uploadsFromFiles = (
  files: ReadonlyArray<File>,
): Promise<ReadonlyArray<ImageUpload>> =>
  settledUploads(
    files.map(uploadOfFile),
    "Notty could not read an image file",
  );

const defaultFetchImage: FetchImage = async (source) => {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not read image source: ${response.status}`);
  }
  return response.blob();
};

const uploadOfSource = async (
  source: string,
  fetchImage: FetchImage,
): Promise<ImageUpload> => {
  const blob = await fetchImage(source);
  const mimeType =
    blob.type.length > 0
      ? blob.type
      : (mimeTypeForSource(source) ?? "image/png");
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    name: nameForSource(source, mimeType),
    mimeType,
  };
};

const uploadsFromSources = (
  sources: ReadonlyArray<string>,
  fetchImage: FetchImage,
): Promise<ReadonlyArray<ImageUpload>> =>
  settledUploads(
    sources.map((source) => uploadOfSource(source, fetchImage)),
    "Notty could not read a pasted image source",
  );

const emptyUploads: Promise<ReadonlyArray<ImageUpload>> = Promise.resolve([]);

/**
 * Decide what a paste or drop should do. It inspects the DOM payload first:
 * files win over HTML, transient HTML images are fetched, portable http(s)
 * images stay as URLs, and only an entirely empty paste may consult the native
 * clipboard. Text pastes never reach the native image reader.
 */
export const planImageIntake = (
  transfer: ImageTransfer | null,
  options: ImageIntakeOptions = {},
): ImageIntakePlan => {
  const files = imageFilesIn(transfer);
  if (files.length > 0) {
    return { handled: true, uploads: uploadsFromFiles(files), external: [] };
  }

  const fetchImage = options.fetchImage ?? defaultFetchImage;
  const sources =
    transfer === null ? [] : imageSourcesInHtml(transfer.getData("text/html"));

  const transient = sources.filter(isTransientImageSource);
  if (transient.length > 0) {
    return {
      handled: true,
      uploads: uploadsFromSources(transient, fetchImage),
      external: [],
    };
  }

  const local = sources.filter(
    (source) => !/^https?:/i.test(source) && !isTransientImageSource(source),
  );
  if (local.length > 0) {
    return {
      handled: true,
      uploads: uploadsFromSources(local, fetchImage),
      external: [],
    };
  }

  const external = sources.filter((source) => /^https?:/i.test(source));
  if (external.length > 0) {
    return { handled: true, uploads: emptyUploads, external };
  }

  const readClipboardImage = options.readClipboardImage;
  const domIsEmpty =
    transfer === null || (transfer.types.length === 0 && files.length === 0);
  if (
    options.allowNativeClipboard === true &&
    readClipboardImage !== undefined &&
    domIsEmpty
  ) {
    return {
      handled: true,
      uploads: readClipboardImage().then((image) => (image === null ? [] : [image])),
      external: [],
    };
  }

  return { handled: false, uploads: emptyUploads, external: [] };
};

/**
 * Store each upload through the attachment saver. A failed image is skipped so
 * one bad payload never blocks the rest of the paste.
 */
export const persistIntakeUploads = async (
  uploads: Promise<ReadonlyArray<ImageUpload>>,
  saveImage: SaveImage,
): Promise<ReadonlyArray<StoredImage>> => {
  let pending: ReadonlyArray<ImageUpload>;
  try {
    pending = await uploads;
  } catch (cause) {
    console.warn("Notty could not read a pasted image", cause);
    return [];
  }

  const stored: StoredImage[] = [];
  for (const upload of pending) {
    try {
      stored.push(await saveImage(upload));
    } catch (cause) {
      console.warn("Notty could not save an image", cause);
    }
  }
  return stored;
};

/**
 * Fetch a transient source and hand its bytes to the attachment saver. Used by
 * the ProseMirror watcher and by the pure rewrite helper below.
 */
export const storeTransientImage = async (
  source: string,
  saveImage: SaveImage,
  fetchImage: FetchImage = defaultFetchImage,
): Promise<StoredImage> =>
  saveImage(await uploadOfSource(source, fetchImage));

/**
 * Pure rewrite of an editor document that still contains `blob:` or `data:`
 * image sources. Tests use it to exercise the same fetch-and-save path as the
 * ProseMirror watcher; the running editor applies the result as node attribute
 * updates instead of replacing the whole document.
 */
export const rewriteTransientImageSources = async (
  content: JSONContent,
  saveImage: SaveImage,
  fetchImage: FetchImage = defaultFetchImage,
): Promise<JSONContent> => {
  const stored = new Map<string, Promise<StoredImage | null>>();

  const persist = (source: string): Promise<StoredImage | null> => {
    const existing = stored.get(source);
    if (existing !== undefined) return existing;
    const pending = storeTransientImage(source, saveImage, fetchImage).catch(
      (cause: unknown) => {
        console.warn("Notty could not save a transient image", cause);
        return null;
      },
    );
    stored.set(source, pending);
    return pending;
  };

  const rewrite = async (node: JSONContent): Promise<JSONContent> => {
    const source = node.attrs?.src;
    if (
      node.type === "image" &&
      typeof source === "string" &&
      isTransientImageSource(source)
    ) {
      const saved = await persist(source);
      if (saved !== null) {
        return { ...node, attrs: { ...node.attrs, src: saved.path } };
      }
      return node;
    }

    if (node.content === undefined) return node;
    return {
      ...node,
      content: await Promise.all(node.content.map(rewrite)),
    };
  };

  return rewrite(content);
};
