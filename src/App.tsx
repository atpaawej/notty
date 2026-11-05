/**
 * Three-column shell: folders, note list, editor.
 *
 * Presentational placeholder — the modules fill in behind this shell as
 * their tickets land. Empty states are honest: nothing here pretends to
 * store or find notes yet.
 */
import "./styles.css";

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

function NoteList() {
  return (
    <section className="note-list" aria-label="Note list">
      <header className="note-list-header">
        <h1>All Notes</h1>
        <button
          className="compose-button"
          type="button"
          disabled
          title="Available once capture ships"
          aria-label="New note (not available yet)"
        >
          <IconCompose />
        </button>
      </header>

      <div className="note-list-empty">
        <h2>No notes yet</h2>
        <p>Notes you create will appear here, ordered by recency. Everything is saved automatically.</p>
      </div>
    </section>
  );
}

function EditorEmptyState() {
  return (
    <main className="editor" aria-label="Editor">
      <div className="editor-empty">
        <h2>Select a note</h2>
        <p>Choose a note from the list to read and edit it here.</p>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <div className="shell">
      <Sidebar />
      <NoteList />
      <EditorEmptyState />
    </div>
  );
}
