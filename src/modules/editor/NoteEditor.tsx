/**
 * Private: the TipTap-backed note body editor.
 *
 * TipTap and ProseMirror types stay inside this file. Callers hand in Markdown,
 * receive Markdown, and never touch an editor instance.
 */
import { Markdown } from "@tiptap/markdown";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import {
  useEffect,
  useRef,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { createEditorExtensions } from "./extensions";

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

export interface NoteEditorProps {
  /** Identity of the note. Changing it rebuilds the editor and its history. */
  readonly noteId: string;
  /** Markdown body to open the editor with. Later values are ignored. */
  readonly body: string;
  /** Fires with the full Markdown body on every document change. */
  readonly onChange: (markdown: string) => void;
  /**
   * Stores pasted or dropped image bytes. Omit it to leave image intake off;
   * the editor never decides where attachments live.
   */
  readonly saveImage?: SaveImage;
  /** Maps a vault-relative attachment reference to a webview URL. */
  readonly resolveImageSrc?: (path: string) => string;
  /** Put the cursor at the end of the body when the editor mounts. */
  readonly autoFocus?: boolean;
}

/** Keep the editor selection while a toolbar button is pressed. */
const keepSelection = (event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
};

const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;

const isImageFile = (file: File): boolean =>
  file.type.startsWith("image/") || IMAGE_FILE_PATTERN.test(file.name);

/** Blob and data URLs die with the webview, so they must become files. */
const isTransientImageSource = (source: string): boolean =>
  /^(?:blob|data):/i.test(source);

const IMAGE_SRC_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Pull image sources out of clipboard or drag HTML without a DOM parser. */
const imageSourcesInHtml = (html: string): string[] => {
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

const nameForSource = (source: string, mimeType: string): string => {
  if (/^data:/i.test(source)) return fallbackImageName(mimeType);
  const withoutQuery = source.split(/[?#]/)[0] ?? source;
  const name = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  return IMAGE_FILE_PATTERN.test(name) ? name : fallbackImageName(mimeType);
};

/**
 * Clipboard and drag payloads expose files through `files` on most platforms
 * and only through `items` on some, so fall back rather than collect both.
 */
const imageFilesIn = (transfer: DataTransfer | null): File[] => {
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

function IconChecklist() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <path d="m4.5 7 1.2 1.2L8 5.5M13 7h8M3 15h6M13 15h8M3 19h6M13 19h8" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16M15 4v16" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

function IconBold() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 5h6a4 4 0 0 1 0 8H7V5Zm0 8h7a4 4 0 0 1 0 8H7v-8Z" />
    </svg>
  );
}

function IconItalic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 5h8M6 19h8M14 5 10 19" />
    </svg>
  );
}

function IconHeading({ level }: { readonly level: 1 | 2 }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5v14M15 5v14M5 12h10" />
      {level === 1 ? null : <path d="M19 19v-6l-2 1.4" />}
    </svg>
  );
}

function IconAddRow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <path d="M12 15v6M9 18h6" />
    </svg>
  );
}

function IconAddColumn() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="7" height="18" rx="1.5" />
      <path d="M16 9v6M13 12h6" />
    </svg>
  );
}

function IconDeleteTable() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

export function NoteEditor({
  noteId,
  body,
  onChange,
  saveImage,
  resolveImageSrc,
  autoFocus = true,
}: NoteEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveImageRef = useRef(saveImage);
  saveImageRef.current = saveImage;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const insertStored = (stored: ReadonlyArray<StoredImage>): void => {
    if (stored.length === 0) return;
    // One insert keeps multiple pasted images from replacing each other: an
    // earlier image would otherwise stay selected when the next one arrives.
    editorRef.current
      ?.chain()
      .focus()
      .insertContent(
        stored.map((image) => ({
          type: "image",
          attrs: { src: image.path, alt: image.alt },
        })),
      )
      .run();
  };

  const insertExternal = (sources: ReadonlyArray<string>): void => {
    if (sources.length === 0) return;
    editorRef.current
      ?.chain()
      .focus()
      .insertContent(
        sources.map((src) => ({
          type: "image",
          attrs: { src, alt: nameForSource(src, "image/png") },
        })),
      )
      .run();
  };

  const insertImages = async (
    files: ReadonlyArray<File>,
  ): Promise<void> => {
    const save = saveImageRef.current;
    if (save === undefined) return;

    const stored: StoredImage[] = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        stored.push(
          await save({
            bytes,
            name: file.name,
            mimeType: file.type,
          }),
        );
      } catch (cause) {
        // There is no upload UI; a failed intake leaves the note untouched.
        console.warn("Notty could not save an image", cause);
      }
    }

    insertStored(stored);
  };

  /** Fetch a webview-only URL and persist its bytes as an attachment. */
  const insertSources = async (
    sources: ReadonlyArray<string>,
  ): Promise<void> => {
    const save = saveImageRef.current;
    if (save === undefined) return;

    const stored: StoredImage[] = [];
    for (const source of sources) {
      try {
        const response = await fetch(source);
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = blob.type.length > 0 ? blob.type : "image/png";
        stored.push(
          await save({
            bytes,
            name: nameForSource(source, mimeType),
            mimeType,
          }),
        );
      } catch (cause) {
        console.warn("Notty could not save a pasted image", cause);
      }
    }

    insertStored(stored);
  };

  /**
   * Image intake for both paste and drop. Files win: WebKit often exposes the
   * same screenshot as both a file and an HTML blob, and saving it twice would
   * create two attachments. HTML-only images (blob or data URLs) are fetched
   * and stored; external http(s) sources stay as portable Markdown references.
   */
  const intakeTransfer = (transfer: DataTransfer | null): boolean => {
    if (saveImageRef.current === undefined) return false;

    const files = imageFilesIn(transfer);
    if (files.length > 0) {
      void insertImages(files);
      return true;
    }

    if (transfer === null) return false;
    const sources = imageSourcesInHtml(transfer.getData("text/html"));
    if (sources.length === 0) return false;

    const transient = sources.filter(isTransientImageSource);
    if (transient.length > 0) {
      void insertSources(transient);
      return true;
    }

    const external = sources.filter((source) => /^https?:/i.test(source));
    const local = sources.filter(
      (source) => !/^https?:/i.test(source) && !isTransientImageSource(source),
    );
    if (local.length > 0) {
      void insertSources(local);
      return true;
    }
    if (external.length === 0) return false;
    insertExternal(external);
    return true;
  };

  // `noteId` is the only dependency: a different note means a fresh editor,
  // which is exactly the per-note undo history the product promises. The
  // resolver reads a ref so a URL source becoming available never rebuilds it.
  const editor = useEditor(
    {
      extensions: [
        ...createEditorExtensions(
          (path) => resolveImageSrcRef.current?.(path) ?? path,
        ),
        Markdown,
      ],
      content: body,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "note-editor-content",
          role: "textbox",
          "aria-label": "Note body",
          "aria-multiline": "true",
        },
        handlePaste: (_view, event) => {
          if (!intakeTransfer(event.clipboardData)) return false;
          event.preventDefault();
          return true;
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false;
          if (!intakeTransfer(event.dataTransfer)) return false;
          event.preventDefault();
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        onChangeRef.current(current.getMarkdown());
      },
    },
    [noteId],
  );
  editorRef.current = editor;

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const alt = current?.getAttributes("image").alt;
      return {
        bold: current?.isActive("bold") ?? false,
        italic: current?.isActive("italic") ?? false,
        heading1: current?.isActive("heading", { level: 1 }) ?? false,
        heading2: current?.isActive("heading", { level: 2 }) ?? false,
        checklist: current?.isActive("taskList") ?? false,
        inTable: current?.isActive("table") ?? false,
        image: current?.isActive("image") ?? false,
        imageAlt: typeof alt === "string" ? alt : "",
      };
    },
  });

  useEffect(() => {
    if (autoFocus) editor.commands.focus("end");
  }, [editor, autoFocus]);

  const pickImages = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const files = Array.from(event.target.files ?? []).filter(isImageFile);
    event.target.value = "";
    await insertImages(files);
  };

  const buttonClass = (isActive: boolean | undefined): string =>
    `editor-dock-button${isActive === true ? " is-active" : ""}`;

  return (
    <div className="note-editor-shell">
      <EditorContent editor={editor} className="note-editor" />
      <div className="note-editor-dock" role="toolbar" aria-label="Formatting">
        <button
          type="button"
          className={buttonClass(active?.checklist)}
          aria-label="Checklist"
          aria-pressed={active?.checklist === true}
          title="Checklist"
          onMouseDown={keepSelection}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          <IconChecklist />
        </button>
        <button
          type="button"
          className="editor-dock-button"
          aria-label="Table"
          title="Insert table"
          onMouseDown={keepSelection}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <IconTable />
        </button>
        <button
          type="button"
          className="editor-dock-button"
          aria-label="Image"
          title="Insert image"
          onMouseDown={keepSelection}
          onClick={() => fileInput.current?.click()}
        >
          <IconImage />
        </button>
        <span className="note-editor-dock-separator" aria-hidden="true" />
        <button
          type="button"
          className={buttonClass(active?.bold)}
          aria-label="Bold"
          aria-pressed={active?.bold === true}
          title="Bold"
          onMouseDown={keepSelection}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <IconBold />
        </button>
        <button
          type="button"
          className={buttonClass(active?.italic)}
          aria-label="Italic"
          aria-pressed={active?.italic === true}
          title="Italic"
          onMouseDown={keepSelection}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <IconItalic />
        </button>
        <button
          type="button"
          className={buttonClass(active?.heading1)}
          aria-label="Heading 1"
          aria-pressed={active?.heading1 === true}
          title="Heading 1"
          onMouseDown={keepSelection}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          <IconHeading level={1} />
        </button>
        <button
          type="button"
          className={buttonClass(active?.heading2)}
          aria-label="Heading 2"
          aria-pressed={active?.heading2 === true}
          title="Heading 2"
          onMouseDown={keepSelection}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <IconHeading level={2} />
        </button>
        {active?.image === true ? (
          <>
            <span className="note-editor-dock-separator" aria-hidden="true" />
            <label className="editor-alt-field">
              <span className="editor-alt-label">Alt</span>
              <input
                className="editor-alt-input"
                type="text"
                value={active.imageAlt}
                aria-label="Image alt text"
                placeholder="Describe this image"
                onChange={(event) =>
                  editor?.commands.updateAttributes("image", {
                    alt: event.target.value,
                  })
                }
              />
            </label>
          </>
        ) : null}
        {active?.inTable === true ? (
          <>
            <span className="note-editor-dock-separator" aria-hidden="true" />
            <button
              type="button"
              className="editor-dock-button"
              aria-label="Add row"
              title="Add row below"
              onMouseDown={keepSelection}
              onClick={() => editor?.chain().focus().addRowAfter().run()}
            >
              <IconAddRow />
            </button>
            <button
              type="button"
              className="editor-dock-button"
              aria-label="Add column"
              title="Add column to the right"
              onMouseDown={keepSelection}
              onClick={() => editor?.chain().focus().addColumnAfter().run()}
            >
              <IconAddColumn />
            </button>
            <button
              type="button"
              className="editor-dock-button is-danger"
              aria-label="Delete table"
              title="Delete table"
              onMouseDown={keepSelection}
              onClick={() => editor?.chain().focus().deleteTable().run()}
            >
              <IconDeleteTable />
            </button>
          </>
        ) : null}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose images"
        onChange={(event) => void pickImages(event)}
      />
    </div>
  );
}
