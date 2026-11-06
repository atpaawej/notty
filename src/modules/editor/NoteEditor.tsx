/**
 * Private: the TipTap-backed note body editor.
 *
 * TipTap and ProseMirror types stay inside this file. Callers hand in Markdown,
 * receive Markdown, and never touch an editor instance.
 */
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useRef, type MouseEvent } from "react";
import { editorExtensions } from "./extensions";

export interface NoteEditorProps {
  /** Identity of the note. Changing it rebuilds the editor and its history. */
  readonly noteId: string;
  /** Markdown body to open the editor with. Later values are ignored. */
  readonly body: string;
  /** Fires with the full Markdown body on every document change. */
  readonly onChange: (markdown: string) => void;
  /** Put the cursor at the end of the body when the editor mounts. */
  readonly autoFocus?: boolean;
}

/** Keep the editor selection while a toolbar button is pressed. */
const keepSelection = (event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
};

export function NoteEditor({
  noteId,
  body,
  onChange,
  autoFocus = true,
}: NoteEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // `noteId` is the only dependency: a different note means a fresh editor,
  // which is exactly the per-note undo history the product promises.
  const editor = useEditor(
    {
      extensions: [...editorExtensions, Markdown],
      content: body,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "note-editor-content",
          role: "textbox",
          "aria-label": "Note body",
          "aria-multiline": "true",
        },
      },
      onUpdate: ({ editor: current }) => {
        onChangeRef.current(current.getMarkdown());
      },
    },
    [noteId],
  );

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      checklist: current?.isActive("taskList") ?? false,
      inTable: current?.isActive("table") ?? false,
    }),
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
