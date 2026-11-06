/**
 * Private: the three-column shell.
 *
 * Layout and shortcuts live here; state, selection and auto-save live in the
 * controller. There is deliberately no save button and no save indicator.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
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

function IconArchive() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" />
      <path d="M3 4h18v4H3V4ZM10 12h4" />
    </svg>
  );
}

interface MenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

interface MenuPosition {
  readonly top: number;
  readonly right: number;
}

/**
 * The one contextual action menu used by folders and notes. It is opened by a
 * `···` trigger that only appears on hover, focus or selection, and closes on
 * an outside click, Escape, scrolling or a resize.
 */
function ActionMenu({
  label,
  actions,
}: {
  readonly label: string;
  readonly actions: ReadonlyArray<MenuAction>;
}) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = position !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target !== null &&
        (menu.current?.contains(target) === true ||
          trigger.current?.contains(target) === true)
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      trigger.current?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setPosition(null);
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPosition({
      top: Math.min(rect.bottom + 4, window.innerHeight - 172),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  };

  return (
    <div className="item-menu">
      <button
        ref={trigger}
        type="button"
        className="item-menu-trigger"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">···</span>
      </button>
      {position === null ? null : (
        <div
          ref={menu}
          className="item-menu-popup"
          role="menu"
          aria-label={`Actions for ${label}`}
          style={{ top: position.top, right: position.right }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={action.danger === true ? "is-danger" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                setPosition(null);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderEditorState {
  readonly mode: "create" | "rename";
  /** The folder being renamed; `null` while creating a folder. */
  readonly folder: string | null;
  readonly value: string;
}

function Sidebar({
  folders,
  selectedFolder,
  showArchived,
  folderEditor,
  onSelectFolder,
  onSelectArchive,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onFolderEditorChange,
  onFolderEditorSubmit,
  onFolderEditorCancel,
}: {
  readonly folders: ReadonlyArray<string>;
  readonly selectedFolder: string | null;
  readonly showArchived: boolean;
  readonly folderEditor: FolderEditorState | null;
  readonly onSelectFolder: (folder: string | null) => void;
  readonly onSelectArchive: () => void;
  readonly onCreateFolder: () => void;
  readonly onRenameFolder: (folder: string) => void;
  readonly onDeleteFolder: (folder: string) => void;
  readonly onFolderEditorChange: (value: string) => void;
  readonly onFolderEditorSubmit: () => void;
  readonly onFolderEditorCancel: () => void;
}) {
  return (
    <nav className="sidebar" aria-label="Folders">
      <div className="wordmark">Notty</div>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Library</h2>
        <button
          className={`sidebar-item${selectedFolder === null && !showArchived ? " is-active" : ""}`}
          type="button"
          aria-current={selectedFolder === null && !showArchived ? "page" : undefined}
          onClick={() => onSelectFolder(null)}
        >
          <IconAllNotes />
          <span>All Notes</span>
        </button>
        <button
          className={`sidebar-item${showArchived ? " is-active" : ""}`}
          type="button"
          aria-current={showArchived ? "page" : undefined}
          onClick={onSelectArchive}
        >
          <IconArchive />
          <span>Archive</span>
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

        {folders.length === 0 ? (
          <p className="sidebar-empty">No folders yet</p>
        ) : (
          <div className="folder-tree">
            {folders.map((folder) => {
              const depth = folder.split("/").length - 1;
              const name = folder.split("/").pop() ?? folder;
              return (
                <div
                  key={folder}
                  className={`sidebar-item sidebar-item-row${folder === selectedFolder && !showArchived ? " is-active" : ""}`}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  title={folder}
                >
                  <button
                    className="sidebar-item-main"
                    type="button"
                    onClick={() => onSelectFolder(folder)}
                  >
                    <IconFolder />
                    <span>{name}</span>
                  </button>
                  <ActionMenu
                    label={name}
                    actions={[
                      { label: "Rename", onSelect: () => onRenameFolder(folder) },
                      {
                        label: "Delete",
                        danger: true,
                        onSelect: () => onDeleteFolder(folder),
                      },
                    ]}
                  />
                </div>
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
  onTogglePin,
  onDuplicate,
  onSetArchived,
}: {
  readonly title: string;
  readonly notes: ReadonlyArray<NoteSummary>;
  readonly selectedId: string | null;
  readonly ready: boolean;
  readonly onCreate: () => void;
  readonly onSelect: (id: string) => void;
  readonly onTogglePin: (id: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onSetArchived: (id: string, archived: boolean) => void;
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
            <div
              key={note.id}
              role="listitem"
              className={`note-list-item${note.id === selectedId ? " is-active" : ""}`}
            >
              <button
                className="note-list-item-main"
                type="button"
                onClick={() => onSelect(note.id)}
              >
                <span className="note-list-item-title">
                  {note.title || "Untitled"}
                </span>
                <time className="note-list-item-date" dateTime={note.modified}>
                  {formatModified(note.modified)}
                </time>
              </button>
              <ActionMenu
                label={note.title || "Untitled"}
                actions={[
                  {
                    label: note.pinned ? "Unpin" : "Pin",
                    onSelect: () => onTogglePin(note.id),
                  },
                  {
                    label: "Duplicate",
                    onSelect: () => onDuplicate(note.id),
                  },
                  {
                    label: note.archived ? "Unarchive" : "Archive",
                    onSelect: () => onSetArchived(note.id, !note.archived),
                  },
                ]}
              />
            </div>
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
  const visibleNotes = state.notes;
  const listTitle = state.showArchived
    ? "Archive"
    : (state.selectedFolder ?? "All Notes");
  const selectedFolderPath =
    state.notes.find((note) => note.id === state.selectedId)?.folder ?? "";

  const [folderEditor, setFolderEditor] = useState<FolderEditorState | null>(
    null,
  );

  const createFolder = () => {
    setFolderEditor({ mode: "create", folder: null, value: "" });
  };

  const renameFolder = (folder: string) => {
    const current = folder.split("/").pop() ?? folder;
    setFolderEditor({ mode: "rename", folder, value: current });
  };

  const deleteFolder = (folder: string) => {
    const confirmed = window.confirm(
      `Delete "${folder}" and every note inside it?`,
    );
    if (confirmed) void controller.deleteFolder(folder);
  };

  const submitFolder = () => {
    if (folderEditor === null) return;
    const name = folderEditor.value;
    if (folderEditor.mode === "create") {
      void controller.createFolder(name);
    } else if (folderEditor.folder !== null) {
      void controller.renameFolder(folderEditor.folder, name);
    }
    setFolderEditor(null);
  };

  return (
    <div className="shell">
      <Sidebar
        folders={state.folders}
        selectedFolder={state.selectedFolder}
        showArchived={state.showArchived}
        folderEditor={folderEditor}
        onSelectFolder={controller.selectFolder}
        onSelectArchive={controller.selectArchive}
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
        onTogglePin={(id) => void controller.togglePin(id)}
        onDuplicate={(id) => void controller.duplicateNote(id)}
        onSetArchived={(id, archived) => void controller.setArchived(id, archived)}
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
