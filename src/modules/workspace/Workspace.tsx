/**
 * Private: the three-column shell.
 *
 * Layout and shortcuts live here; state, selection and auto-save live in the
 * controller. There is deliberately no save button and no save indicator.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NoteEditor } from "../editor";
import type { NoteSummary } from "../note-index";
import {
  createWorkspace,
  type NoteStore,
  type WorkspaceController,
} from "./workspace";

export interface WorkspaceProps {
  readonly store: NoteStore;
  /**
   * Handed the controller so the composition root can flush pending edits
   * before the window closes. Called with `null` on unmount.
   */
  readonly onController?: (controller: WorkspaceController | null) => void;
}

function IconAllNotes() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8l4 4v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M10 10h6M10 14h6M10 18h4" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 12a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12" />
    </svg>
  );
}

function IconCompose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 5.5 18.5 9.5M4 20l1.2-4.2L15.7 5.3a2.1 2.1 0 0 1 3 0l0 0a2.1 2.1 0 0 1 0 3L8.2 18.8 4 20Z" />
    </svg>
  );
}

function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Folders">
      <div className="wordmark">Notty</div>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Library</h2>
        <button className="sidebar-item is-active" type="button" aria-current="page">
          <IconAllNotes />
          <span>All Notes</span>
        </button>
      </div>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Folders</h2>
        <p className="sidebar-empty">No folders yet</p>
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-item" type="button" title="Trash arrives with the delete flow">
          <IconTrash />
          <span>Trash</span>
        </button>
        <p className="vault-note">Notes are plain Markdown files in your vault.</p>
      </div>
    </nav>
  );
}

const formatModified = (modified: string): string => {
  const date = new Date(modified);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

function NoteList({
  notes,
  selectedId,
  ready,
  onCreate,
  onSelect,
}: {
  readonly notes: ReadonlyArray<NoteSummary>;
  readonly selectedId: string | null;
  readonly ready: boolean;
  readonly onCreate: () => void;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <section className="note-list" aria-label="Note list">
      <header className="note-list-header">
        <h1>All Notes</h1>
        <button
          className="compose-button"
          type="button"
          aria-label="New note"
          title="New note (Ctrl+N)"
          onClick={onCreate}
        >
          <IconCompose />
        </button>
      </header>

      {notes.length === 0 ? (
        <div className="note-list-empty">
          <h2>{ready ? "No notes yet" : "Opening your vault…"}</h2>
          {ready ? (
            <p>Press Ctrl+N or the compose button to start writing. Everything saves automatically.</p>
          ) : null}
        </div>
      ) : (
        <div className="note-list-items" role="list">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              role="listitem"
              className={`note-list-item${note.id === selectedId ? " is-active" : ""}`}
              onClick={() => onSelect(note.id)}
            >
              <span className="note-list-item-title">{note.title || "Untitled"}</span>
              <time className="note-list-item-date" dateTime={note.modified}>
                {formatModified(note.modified)}
              </time>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function Workspace({ store, onController }: WorkspaceProps) {
  const controller = useMemo(() => createWorkspace(store), [store]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    onController?.(controller);
    return () => onController?.(null);
  }, [controller, onController]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        void controller.createNote();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller]);

  const selected = state.selected;

  return (
    <div className="shell">
      <Sidebar />
      <NoteList
        notes={state.notes}
        selectedId={state.selectedId}
        ready={state.ready}
        onCreate={() => void controller.createNote()}
        onSelect={(id) => void controller.selectNote(id)}
      />
      {selected === null ? (
        <main className="editor" aria-label="Editor">
          <div className="editor-empty">
            <h2>Select a note</h2>
            <p>Choose a note from the list, or press Ctrl+N to start a new one.</p>
          </div>
        </main>
      ) : (
        <main className="editor" aria-label="Editor">
          <div className="editor-note">
            <input
              className="note-title"
              type="text"
              value={selected.title}
              aria-label="Note title"
              onChange={(event) => controller.setTitle(event.target.value)}
            />
            <NoteEditor
              key={selected.id}
              noteId={selected.id}
              body={selected.body}
              onChange={controller.setBody}
            />
          </div>
        </main>
      )}
    </div>
  );
}
