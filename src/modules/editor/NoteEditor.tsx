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
import { useEffect, useRef, type MouseEvent } from "react";
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
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);

  return files.filter(isImageFile);
};

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

  const insertImages = async (files: ReadonlyArray<File>): Promise<void> => {
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
          if (saveImageRef.current === undefined) return false;
          const files = imageFilesIn(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertImages(files);
          return true;
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved || saveImageRef.current === undefined) return false;
          const files = imageFilesIn(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertImages(files);
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

  return (
    <div className="note-editor-shell">
      <div className="note-editor-toolbar" role="toolbar" aria-label="Insert">
        <button
          type="button"
          className={`editor-toolbar-button${active?.checklist === true ? " is-active" : ""}`}
          aria-label="Checklist"
          aria-pressed={active?.checklist === true}
          title="Toggle checklist"
          onMouseDown={keepSelection}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          Checklist
        </button>
        <button
          type="button"
          className="editor-toolbar-button"
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
          Table
        </button>
        {active?.image === true ? (
          <>
            <span
              className="note-editor-toolbar-separator"
              aria-hidden="true"
            />
            <label className="editor-alt-field">
              <span className="editor-alt-label">Alt text</span>
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
            <span
              className="note-editor-toolbar-separator"
              aria-hidden="true"
            />
            <button
              type="button"
              className="editor-toolbar-button"
              aria-label="Add row"
              title="Add row below"
              onMouseDown={keepSelection}
              onClick={() => editor?.chain().focus().addRowAfter().run()}
            >
              Add row
            </button>
            <button
              type="button"
              className="editor-toolbar-button"
              aria-label="Add column"
              title="Add column to the right"
              onMouseDown={keepSelection}
              onClick={() => editor?.chain().focus().addColumnAfter().run()}
            >
              Add column
            </button>
            <button
              type="button"
              className="editor-toolbar-button is-danger"
              aria-label="Delete table"
              title="Delete table"
              onMouseDown={keepSelection}
              onClick={() => editor?.chain().focus().deleteTable().run()}
            >
              Delete table
            </button>
          </>
        ) : null}
      </div>
      <EditorContent editor={editor} className="note-editor" />
    </div>
  );
}
