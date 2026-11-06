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
import { NoteEditor, type ImageUpload, type StoredImage } from "../editor";
import type { NoteSummary } from "../note-index";
import {
  createWorkspace,
  type NoteStore,
  type WorkspaceController,
  type WorkspaceView,
} from "./workspace";

/** The attachment intake the composition root supplies to the editor. */
export interface WorkspaceAttachments {
  readonly saveImage: (upload: ImageUpload) => Promise<StoredImage>;
  readonly imageSrc: (path: string) => string;
}

export interface WorkspaceProps {
  readonly store: NoteStore;
  /**
   * Image intake and rendering. Omitted when the runtime has no attachment
   * storage; the editor then ignores pastes and drops of images.
   */
  readonly attachments?: WorkspaceAttachments;
  /**
   * Handed the controller so the composition root can flush pending edits
   * before the window closes. Called with `null` on unmount.
   */
  readonly onController?: (controller: WorkspaceController | null) => void;
  /** Open the app settings dialog. */
  readonly onOpenSettings?: () => void;
  /** Show a warning on the settings entry when the global shortcut failed. */
  readonly hotkeyError?: boolean;
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

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
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
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 172)),
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
  selectedView,
  folderEditor,
  hotkeyError,
  onSelectFolder,
  onSelectArchive,
  onSelectTrash,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onFolderEditorChange,
  onFolderEditorSubmit,
  onFolderEditorCancel,
  onOpenSettings,
}: {
  readonly folders: ReadonlyArray<string>;
  readonly selectedFolder: string | null;
  readonly selectedView: WorkspaceView;
  readonly folderEditor: FolderEditorState | null;
  readonly hotkeyError: boolean;
  readonly onSelectFolder: (folder: string | null) => void;
  readonly onSelectArchive: () => void;
  readonly onSelectTrash: () => void;
  readonly onCreateFolder: () => void;
  readonly onRenameFolder: (folder: string) => void;
  readonly onDeleteFolder: (folder: string) => void;
  readonly onFolderEditorChange: (value: string) => void;
  readonly onFolderEditorSubmit: () => void;
  readonly onFolderEditorCancel: () => void;
  readonly onOpenSettings: (() => void) | undefined;
}) {
  const showingAll = selectedView === "all" && selectedFolder === null;
  const showingArchive = selectedView === "archive";
  const showingTrash = selectedView === "trash";
  return (
    <nav className="sidebar" aria-label="Folders">
      <div className="wordmark">Notty</div>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Library</h2>
        <button
          className={`sidebar-item${showingAll ? " is-active" : ""}`}
          type="button"
          aria-current={showingAll ? "page" : undefined}
          onClick={() => onSelectFolder(null)}
        >
          <IconAllNotes />
          <span>All Notes</span>
        </button>
        <button
          className={`sidebar-item${showingArchive ? " is-active" : ""}`}
          type="button"
          aria-current={showingArchive ? "page" : undefined}
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
                  className={`sidebar-item sidebar-item-row${folder === selectedFolder && selectedView === "all" ? " is-active" : ""}`}
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
        <button
          className={`sidebar-item${showingTrash ? " is-active" : ""}`}
          type="button"
          aria-current={showingTrash ? "page" : undefined}
          title="Trash"
          onClick={onSelectTrash}
        >
          <IconTrash />
          <span>Trash</span>
        </button>
        {onOpenSettings === undefined ? null : (
          <button
            className={`sidebar-item${hotkeyError ? " has-warning" : ""}`}
            type="button"
            title={
              hotkeyError
                ? "Global shortcut unavailable — open settings"
                : "Settings"
            }
            onClick={onOpenSettings}
          >
            <IconSettings />
            <span>Settings</span>
            {hotkeyError ? (
              <span
                className="sidebar-badge"
                aria-label="Global shortcut unavailable"
              >
                !
              </span>
            ) : null}
          </button>
        )}
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
  view,
  notes,
  selectedId,
  ready,
  searchQuery,
  searching,
  showFolder,
  onCreate,
  onSelect,
  onSearchChange,
  onTogglePin,
  onDuplicate,
  onSetArchived,
  onMove,
  onTrash,
  onRestore,
  onPurge,
  onEmptyTrash,
}: {
  readonly title: string;
  readonly view: WorkspaceView;
  readonly notes: ReadonlyArray<NoteSummary>;
  readonly selectedId: string | null;
  readonly ready: boolean;
  readonly searchQuery: string;
  readonly searching: boolean;
  readonly showFolder: boolean;
  readonly onCreate: () => void;
  readonly onSelect: (id: string) => void;
  readonly onSearchChange: (query: string) => void;
  readonly onTogglePin: (id: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onSetArchived: (id: string, archived: boolean) => void;
  readonly onMove: (id: string) => void;
  readonly onTrash: (id: string) => void;
  readonly onRestore: (id: string) => void;
  readonly onPurge: (id: string) => void;
  readonly onEmptyTrash: () => void;
}) {
  const hasQuery = searchQuery.trim().length > 0;
  const isTrash = view === "trash";
  return (
    <section className="note-list" aria-label="Note list">
      <header className="note-list-header">
        <h1>{title}</h1>
        {isTrash ? (
          notes.length === 0 ? null : (
            <button
              className="trash-empty-button"
              type="button"
              onClick={onEmptyTrash}
            >
              Empty Trash
            </button>
          )
        ) : (
          <button
            className="compose-button"
            type="button"
            aria-label="New note"
            title="New note (Ctrl+N)"
            onClick={onCreate}
          >
            <IconCompose />
          </button>
        )}
      </header>

      {isTrash ? (
        <p className="trash-banner">
          Notes in the Trash are kept for 30 days, then permanently deleted.
        </p>
      ) : null}

      {isTrash ? null : (
        <div className="note-list-search">
          <input
            type="search"
            value={searchQuery}
            aria-label="Search notes"
            placeholder="Search"
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onSearchChange("");
              }
            }}
          />
        </div>
      )}

      {notes.length === 0 ? (
        <div className="note-list-empty">
          <h2>
            {isTrash
              ? "Trash is empty"
              : !ready
                ? "Opening your vault…"
                : hasQuery
                  ? searching
                    ? "Searching…"
                    : "No matches"
                  : "No notes yet"}
          </h2>
          {ready && !searching ? (
            <p>
              {isTrash
                ? "Notes you move to the Trash appear here for 30 days."
                : hasQuery
                  ? "Try a different word or spelling."
                  : "Press Ctrl+N or the compose button to start writing. Everything saves automatically."}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="note-list-items" role="list">
          {notes.map((note) => (
            <div
              key={note.id}
              role="listitem"
              className={`note-list-item${note.id === selectedId ? " is-active" : ""}${isTrash ? " is-trash" : ""}`}
            >
              <button
                className="note-list-item-main"
                type="button"
                onClick={() => onSelect(note.id)}
              >
                <span className="note-list-item-title">
                  {note.title || "New Note"}
                </span>
                <span className="note-list-item-meta">
                  <time className="note-list-item-date" dateTime={note.modified}>
                    {formatModified(note.modified)}
                  </time>
                  {showFolder && note.folder.length > 0 ? (
                    <span className="note-folder-chip">{note.folder}</span>
                  ) : null}
                </span>
              </button>
              {isTrash ? (
                <div className="trash-item-actions">
                  <button
                    className="trash-action"
                    type="button"
                    onClick={() => onRestore(note.id)}
                  >
                    Restore
                  </button>
                  <button
                    className="trash-action is-danger"
                    type="button"
                    onClick={() => onPurge(note.id)}
                  >
                    Delete Permanently
                  </button>
                </div>
              ) : (
                <ActionMenu
                  label={note.title || "New Note"}
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
                    {
                      label: "Move to Folder…",
                      onSelect: () => onMove(note.id),
                    },
                    {
                      label: "Move to Trash",
                      danger: true,
                      onSelect: () => onTrash(note.id),
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface MoveNoteDialogProps {
  readonly folders: ReadonlyArray<string>;
  readonly currentFolder: string;
  readonly onMove: (folder: string) => void;
  readonly onCreateFolder: (name: string) => Promise<string | null>;
  readonly onClose: () => void;
}

/**
 * One focused destination picker. Escape and the scrim both cancel without
 * moving; choosing a folder moves immediately and closes.
 */
function MoveNoteDialog({
  folders,
  currentFolder,
  onMove,
  onCreateFolder,
  onClose,
}: MoveNoteDialogProps) {
  const [query, setQuery] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    search.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || dialog.current === null) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const trimmedQuery = query.trim().toLowerCase();
  const visibleFolders = folders.filter((folder) =>
    folder.toLowerCase().includes(trimmedQuery),
  );

  const choose = (folder: string) => {
    onMove(folder);
    onClose();
  };

  const create = async () => {
    const name = newFolder.trim();
    if (name.length === 0 || creating) return;
    setCreating(true);
    const folder = await onCreateFolder(name);
    setCreating(false);
    if (folder !== null) choose(folder);
  };

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
      >
        <header className="move-dialog-header">
          <h2 id="move-dialog-title">Move to Folder</h2>
          <button
            className="settings-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <input
          ref={search}
          className="move-dialog-search"
          type="search"
          value={query}
          placeholder="Search folders"
          aria-label="Search folders"
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="move-folder-list" role="listbox" aria-label="Folders">
          <button
            type="button"
            role="option"
            aria-selected={currentFolder === ""}
            className={`move-folder-option${currentFolder === "" ? " is-current" : ""}`}
            onClick={() => choose("")}
          >
            <IconFolder />
            <span>Vault root</span>
            {currentFolder === "" ? (
              <span className="move-folder-current">Current</span>
            ) : null}
          </button>
          {visibleFolders.map((folder) => (
            <button
              key={folder}
              type="button"
              role="option"
              aria-selected={folder === currentFolder}
              className={`move-folder-option${folder === currentFolder ? " is-current" : ""}`}
              onClick={() => choose(folder)}
            >
              <IconFolder />
              <span>{folder}</span>
              {folder === currentFolder ? (
                <span className="move-folder-current">Current</span>
              ) : null}
            </button>
          ))}
          {visibleFolders.length === 0 && query.trim().length > 0 ? (
            <p className="move-folder-empty">No folders match.</p>
          ) : null}
        </div>

        <form
          className="move-new-folder"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            type="text"
            value={newFolder}
            aria-label="New folder name"
            placeholder="New folder name"
            onChange={(event) => setNewFolder(event.target.value)}
          />
          <button
            className="settings-button"
            type="submit"
            disabled={newFolder.trim().length === 0 || creating}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function Workspace({ store, attachments, onController, onOpenSettings, hotkeyError = false }: WorkspaceProps) {
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
        return;
      }

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, [contenteditable='true']") !== null
      ) {
        return;
      }

      const current = controller.getState();
      if (current.selectedView === "trash" || current.selectedId === null) {
        return;
      }
      if (
        event.key === "Delete" ||
        (event.ctrlKey && event.key === "Backspace")
      ) {
        event.preventDefault();
        void controller.trashNote(current.selectedId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller]);

  const selected = state.selected;
  const searching = state.searchQuery.trim().length > 0;
  const visibleNotes = searching ? state.searchResults : state.notes;
  const listTitle = searching
    ? "Search"
    : state.selectedView === "trash"
      ? "Trash"
      : state.selectedView === "archive"
        ? "Archive"
        : (state.selectedFolder ?? "All Notes");
  const showFolderBadge =
    !searching &&
    state.selectedView === "all" &&
    state.selectedFolder === null;
  const selectedSummary =
    state.searchResults.find((note) => note.id === state.selectedId) ??
    state.notes.find((note) => note.id === state.selectedId);

  const [folderEditor, setFolderEditor] = useState<FolderEditorState | null>(
    null,
  );
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const moveTarget =
    moveTargetId === null
      ? undefined
      : (state.notes.find((note) => note.id === moveTargetId) ??
        state.searchResults.find((note) => note.id === moveTargetId));

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

  const moveNote = (folder: string) => {
    const id = moveTargetId;
    setMoveTargetId(null);
    if (id !== null) void controller.moveNote(id, folder);
  };

  const emptyTrash = () => {
    const confirmed = window.confirm(
      "Permanently delete every note in the Trash? This cannot be undone.",
    );
    if (confirmed) void controller.emptyTrash();
  };

  return (
    <div className="shell">
      <Sidebar
        folders={state.folders}
        selectedFolder={state.selectedFolder}
        selectedView={state.selectedView}
        folderEditor={folderEditor}
        hotkeyError={hotkeyError}
        onSelectFolder={controller.selectFolder}
        onSelectArchive={controller.selectArchive}
        onSelectTrash={() => void controller.selectTrash()}
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
        onOpenSettings={onOpenSettings}
      />
      <NoteList
        title={listTitle}
        view={state.selectedView}
        notes={visibleNotes}
        selectedId={state.selectedId}
        ready={state.ready}
        searchQuery={state.searchQuery}
        searching={state.searching}
        showFolder={showFolderBadge}
        onCreate={() => void controller.createNote()}
        onSelect={(id) => void controller.selectNote(id)}
        onSearchChange={controller.setSearchQuery}
        onTogglePin={(id) => void controller.togglePin(id)}
        onDuplicate={(id) => void controller.duplicateNote(id)}
        onSetArchived={(id, archived) => void controller.setArchived(id, archived)}
        onMove={setMoveTargetId}
        onTrash={(id) => void controller.trashNote(id)}
        onRestore={(id) => void controller.restoreNote(id)}
        onPurge={(id) => void controller.purgeNote(id)}
        onEmptyTrash={emptyTrash}
      />
      {selected === null ? (
        <main className="editor" aria-label="Editor">
          <div className="editor-empty">
            <h2>
              {state.selectedView === "trash" ? "Trash" : "Select a note"}
            </h2>
            <p>
              {state.selectedView === "trash"
                ? "Restore a note to put it back in its folder, or delete it permanently."
                : "Choose a note from the list, or press Ctrl+N to start a new one."}
            </p>
          </div>
        </main>
      ) : (
        <main className="editor" aria-label="Editor">
          <div className="editor-note">
            <div className="editor-header">
              <div className="editor-heading">
                <input
                  className={`note-title${selected.title === "New Note" && !selected.titleLocked ? " is-placeholder" : ""}`}
                  type="text"
                  value={selected.title}
                  aria-label="Note title"
                  onChange={(event) => controller.setTitle(event.target.value)}
                />
                {selectedSummary === undefined ? null : (
                  <p className="note-timestamp">
                    {selectedSummary.created === selectedSummary.modified
                      ? `Edited ${formatModified(selectedSummary.modified)}`
                      : `Created ${formatModified(selectedSummary.created)} · Edited ${formatModified(selectedSummary.modified)}`}
                  </p>
                )}
              </div>
              <ActionMenu
                label={selected.title || "New Note"}
                actions={[
                  {
                    label: "Move to Folder…",
                    onSelect: () => setMoveTargetId(selected.id),
                  },
                  {
                    label: "Move to Trash",
                    danger: true,
                    onSelect: () => void controller.trashNote(selected.id),
                  },
                ]}
              />
            </div>
            <NoteEditor
              key={selected.id}
              noteId={selected.id}
              body={selected.body}
              onChange={controller.setBody}
              saveImage={attachments?.saveImage}
              resolveImageSrc={attachments?.imageSrc}
            />
          </div>
        </main>
      )}
      {moveTarget === undefined ? null : (
        <MoveNoteDialog
          folders={state.folders}
          currentFolder={moveTarget.folder}
          onMove={moveNote}
          onCreateFolder={(name) => controller.createFolder(name)}
          onClose={() => setMoveTargetId(null)}
        />
      )}
    </div>
  );
}
