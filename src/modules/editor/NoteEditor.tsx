/**
 * Private: the TipTap-backed note body editor.
 *
 * TipTap and ProseMirror types stay inside this file. Callers hand in Markdown,
 * receive Markdown, and never touch an editor instance.
 */
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

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
      extensions: [StarterKit, Markdown],
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

  useEffect(() => {
    if (autoFocus) editor.commands.focus("end");
  }, [editor, autoFocus]);

  return <EditorContent editor={editor} className="note-editor" />;
}
