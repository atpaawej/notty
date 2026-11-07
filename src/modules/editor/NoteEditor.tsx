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
import {
  isImageFile,
  nameForSource,
  persistIntakeUploads,
  planImageIntake,
  uploadsFromFiles,
  type ClipboardImageReader,
  type SaveImage,
  type StoredImage,
} from "./image-intake";
import { resetEditorHistory } from "./history";
import { createTransientImageExtension } from "./transient-images";

/** Serialization waits this long after the last keystroke. */
export const SERIALIZE_DELAY_MS = 300;

export interface NoteEditorProps {
  /** Identity of the note. Changing it swaps content and resets history. */
  readonly noteId: string;
  /**
   * Markdown body to show. A later value replaces the document only when the
   * buffer is clean; keystrokes in flight always win.
   */
  readonly body: string;
  /**
   * Fires with the full Markdown body after the serialization debounce or on
   * blur. It is deliberately not called on every keystroke.
   */
  readonly onChange: (markdown: string) => void;
  /** True while the document has keystrokes not yet passed to `onChange`. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /**
   * Stores pasted or dropped image bytes. Omit it to leave image intake off;
   * the editor never decides where attachments live.
   */
  readonly saveImage?: SaveImage;
  /**
   * Reads pixels from the system clipboard when WebKitGTK supplies no image
   * in the DOM paste event. Omit it in environments without native access.
   */
  readonly readClipboardImage?: ClipboardImageReader;
  /** Maps a vault-relative attachment reference to a webview URL. */
  readonly resolveImageSrc?: (path: string) => string;
  /** Put the cursor at the end of the body when the editor mounts. */
  readonly autoFocus?: boolean;
}

/** Keep the editor selection while a toolbar button is pressed. */
const keepSelection = (event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
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
  onDirtyChange,
  saveImage,
  readClipboardImage,
  resolveImageSrc,
  autoFocus = true,
}: NoteEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const saveImageRef = useRef(saveImage);
  saveImageRef.current = saveImage;
  const readClipboardImageRef = useRef(readClipboardImage);
  readClipboardImageRef.current = readClipboardImage;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const bodyRef = useRef(body);
  bodyRef.current = body;
  /** The Markdown the mounted document currently represents. */
  const lastAppliedBody = useRef(body);
  const previousNoteId = useRef(noteId);
  const dirtyRef = useRef(false);
  const serializeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markDirty = (dirty: boolean): void => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  };

  /**
   * Serialize once, after typing has settled. This is the only place
   * `getMarkdown()` runs, so keystrokes never pay the Markdown cost.
   */
  const flushSerialization = (): void => {
    if (serializeTimer.current !== null) {
      clearTimeout(serializeTimer.current);
      serializeTimer.current = null;
    }
    if (!dirtyRef.current) return;
    const current = editorRef.current;
    if (current === null) return;

    const markdown = current.getMarkdown();
    lastAppliedBody.current = markdown;
    markDirty(false);
    onChangeRef.current(markdown);
  };

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

  const storeUploads = async (
    uploads: Parameters<typeof persistIntakeUploads>[0],
  ): Promise<void> => {
    const save = saveImageRef.current;
    if (save === undefined) return;
    insertStored(await persistIntakeUploads(uploads, save));
  };

  /**
   * Image intake for paste, drop and the file picker. Files win: WebKit often
   * exposes the same screenshot as both a file and an HTML blob, and saving it
   * twice would create two attachments. HTML-only images (blob or data URLs)
   * are fetched and stored; external http(s) sources stay as portable Markdown
   * references. Paste may fall back to the native clipboard when the DOM
   * payload is completely empty.
   */
  const intakeTransfer = (
    transfer: DataTransfer | null,
    allowNativeClipboard: boolean,
  ): boolean => {
    if (saveImageRef.current === undefined) return false;

    const plan = planImageIntake(transfer, {
      allowNativeClipboard,
      ...(readClipboardImageRef.current === undefined
        ? {}
        : { readClipboardImage: readClipboardImageRef.current }),
    });
    if (!plan.handled) return false;

    insertExternal(plan.external);
    void storeUploads(plan.uploads);
    return true;
  };

  // One mounted editor for the life of the workspace. Switching notes swaps
  // content and resets history; it never pays WebKitGTK's instantiation cost.
  // The resolver reads a ref so a URL source becoming available never rebuilds
  // the instance.
  const editor = useEditor(
    {
      extensions: [
        ...createEditorExtensions(
          (path) => resolveImageSrcRef.current?.(path) ?? path,
        ),
        createTransientImageExtension(() => saveImageRef.current),
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
          if (!intakeTransfer(event.clipboardData, true)) return false;
          event.preventDefault();
          return true;
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false;
          if (!intakeTransfer(event.dataTransfer, false)) return false;
          event.preventDefault();
          return true;
        },
      },
      onUpdate: () => {
        markDirty(true);
        if (serializeTimer.current !== null) {
          clearTimeout(serializeTimer.current);
        }
        serializeTimer.current = setTimeout(() => {
          serializeTimer.current = null;
          flushSerialization();
        }, SERIALIZE_DELAY_MS);
      },
      // Clicking the note list blurs the editor first, so the last keystrokes
      // are serialized before the workspace switches notes.
      onBlur: () => flushSerialization(),
    },
    [],
  );
  editorRef.current = editor;

  // A different note reuses the mounted editor. `emitUpdate: false` keeps the
  // content swap out of the auto-save path; `contentType: "markdown"` keeps
  // TipTap's Markdown parser in the path instead of treating the body as HTML.
  // The history reset keeps Ctrl+Z from reaching into the previous note.
  useEffect(() => {
    if (previousNoteId.current === noteId) return;
    previousNoteId.current = noteId;
    if (editor === null) return;

    const markdown = bodyRef.current;
    editor.commands.setContent(markdown, {
      emitUpdate: false,
      contentType: "markdown",
    });
    resetEditorHistory(editor);
    lastAppliedBody.current = markdown;
    markDirty(false);
  }, [editor, noteId]);

  // External edits to the open note arrive as a new body. A clean buffer
  // reloads as parsed Markdown while keeping the cursor anchor; a dirty buffer
  // is left untouched.
  useEffect(() => {
    if (editor === null) return;
    if (body === lastAppliedBody.current) return;
    if (dirtyRef.current) return;

    const { from, to } = editor.state.selection;
    editor.commands.setContent(body, {
      emitUpdate: false,
      contentType: "markdown",
    });
    lastAppliedBody.current = body;

    const limit = editor.state.doc.content.size;
    editor.commands.setTextSelection({
      from: Math.min(from, limit),
      to: Math.min(to, limit),
    });
  }, [body, editor]);

  useEffect(
    () => () => {
      if (serializeTimer.current !== null) {
        clearTimeout(serializeTimer.current);
        serializeTimer.current = null;
      }
      flushSerialization();
    },
    [],
  );

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
    await storeUploads(uploadsFromFiles(files));
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
