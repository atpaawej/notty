/**
 * Private: the three-column shell.
 *
 * Layout and shortcuts live here; state, selection and auto-save live in the
 * controller. There is deliberately no save button and no save indicator.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
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

interface FolderEditorState {
  readonly mode: "create" | "rename";
  readonly value: string;
}

function Sidebar({
  folders,
  selectedFolder,
  folderEditor,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onFolderEditorChange,
  onFolderEditorSubmit,
  onFolderEditorCancel,
}: {
  readonly folders: ReadonlyArray<string>;
  readonly selectedFolder: string | null;
  readonly folderEditor: FolderEditorState | null;
  readonly onSelectFolder: (folder: string | null) => void;
  readonly onCreateFolder: () => void;
  readonly onRenameFolder: () => void;
  readonly onDeleteFolder: () => void;
  readonly onFolderEditorChange: (value: string) => void;
  readonly onFolderEditorSubmit: () => void;
  readonly onFolderEditorCancel: () => void;
}) {
  const selectedName =
    selectedFolder === null
      ? null
      : (selectedFolder.split("/").pop() ?? selectedFolder);

  return (
    <nav className="sidebar" aria-label="Folders">
      <div className="wordmark">Notty</div>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Library</h2>
        <button
          className={`sidebar-item${selectedFolder === null ? " is-active" : ""}`}
          type="button"
          aria-current={selectedFolder === null ? "page" : undefined}
          onClick={() => onSelectFolder(null)}
        >
          <IconAllNotes />
          <span>All Notes</span>
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading-row">
          <h2 className="sidebar-heading">Folders</h2>
          <button
            className="sidebar-action"
            type="button"
            aria-label="New folder"
            title={
              selectedFolder === null
                ? "New folder"
                : `New folder inside ${selectedFolder}`
            }
            onClick={onCreateFolder}
          >
            +
          </button>
        </div>

        {folderEditor === null ? null : (
          <form
            className="folder-form"
            onSubmit={(event) => {
              event.preventDefault();
              onFolderEditorSubmit();
            }}
          >
            <input
              autoFocus
              value={folderEditor.value}
              aria-label={
                folderEditor.mode === "create" ? "New folder name" : "Folder name"
              }
              placeholder={
                folderEditor.mode === "create" ? "New folder" : "Folder name"
              }
              onChange={(event) => onFolderEditorChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onFolderEditorCancel();
                }
              }}
            />
          </form>
        )}

        {selectedFolder === null || folderEditor !== null ? null : (
          <div className="sidebar-folder-actions">
            <button type="button" onClick={onRenameFolder}>
              Rename {selectedName}
            </button>
            <button type="button" onClick={onDeleteFolder}>
              Delete
            </button>
          </div>
        )}

        {folders.length === 0 ? (
          <p className="sidebar-empty">No folders yet</p>
        ) : (
          <div className="folder-tree">
            {folders.map((folder) => {
              const depth = folder.split("/").length - 1;
              const name = folder.split("/").pop() ?? folder;
              return (
                <button
                  key={folder}
                  className={`sidebar-item${folder === selectedFolder ? " is-active" : ""}`}
                  type="button"
                  title={folder}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() => onSelectFolder(folder)}
                >
                  <IconFolder />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        )}
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
  title,
  notes,
  selectedId,
  ready,
  onCreate,
  onSelect,
}: {
  readonly title: string;
  readonly notes: ReadonlyArray<NoteSummary>;
  readonly selectedId: string | null;
  readonly ready: boolean;
  readonly onCreate: () => void;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <section className="note-list" aria-label="Note list">
      <header className="note-list-header">
        <h1>{title}</h1>
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
  const visibleNotes =
    state.selectedFolder === null
      ? state.notes
      : state.notes.filter((note) => note.folder === state.selectedFolder);
  const listTitle = state.selectedFolder ?? "All Notes";
  const selectedFolderPath =
    state.notes.find((note) => note.id === state.selectedId)?.folder ?? "";

  const [folderEditor, setFolderEditor] = useState<FolderEditorState | null>(
    null,
  );

  const createFolder = () => {
    setFolderEditor({ mode: "create", value: "" });
  };

  const renameFolder = () => {
    if (state.selectedFolder === null) return;
    const current = state.selectedFolder.split("/").pop() ?? state.selectedFolder;
    setFolderEditor({ mode: "rename", value: current });
  };

  const deleteFolder = () => {
    if (state.selectedFolder === null) return;
    const confirmed = window.confirm(
      `Delete "${state.selectedFolder}" and every note inside it?`,
    );
    if (confirmed) void controller.deleteFolder(state.selectedFolder);
  };

  const submitFolder = () => {
    if (folderEditor === null) return;
    const name = folderEditor.value;
    if (folderEditor.mode === "create") {
      void controller.createFolder(name);
    } else if (state.selectedFolder !== null) {
      void controller.renameFolder(state.selectedFolder, name);
    }
    setFolderEditor(null);
  };

  return (
    <div className="shell">
      <Sidebar
        folders={state.folders}
        selectedFolder={state.selectedFolder}
        folderEditor={folderEditor}
        onSelectFolder={controller.selectFolder}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onFolderEditorChange={(value) =>
          setFolderEditor((current) =>
            current === null ? null : { ...current, value },
          )
        }
        onFolderEditorSubmit={submitFolder}
        onFolderEditorCancel={() => setFolderEditor(null)}
      />
      <NoteList
        title={listTitle}
        notes={visibleNotes}
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
            <label className="note-folder">
              <span>Folder</span>
              <select
                value={selectedFolderPath}
                aria-label="Note folder"
                onChange={(event) =>
                  void controller.moveNote(selected.id, event.target.value)
                }
              >
                <option value="">Vault root</option>
                {selectedFolderPath !== "" &&
                !state.folders.includes(selectedFolderPath) ? (
                  <option value={selectedFolderPath}>{selectedFolderPath}</option>
                ) : null}
                {state.folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </label>
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
