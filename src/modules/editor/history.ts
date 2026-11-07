/**
 * Private: reset the editor's undo history without rebuilding the editor.
 *
 * TipTap 3.32 ships history through `@tiptap/extensions`' UndoRedo extension,
 * which exposes `undo`/`redo` but no `clearHistory` command. Replacing the
 * editor state with the same document and plugins re-initialises every plugin
 * state — including ProseMirror history — while keeping the mounted view,
 * selection and document intact.
 */
import type { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";

export const resetEditorHistory = (editor: Editor): void => {
  const { state, view } = editor;
  view.updateState(
    EditorState.create({
      doc: state.doc,
      selection: state.selection,
      storedMarks: state.storedMarks,
      plugins: state.plugins,
    }),
  );
};
