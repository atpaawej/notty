/**
 * Private: the interactive three-column Notty replica in the hero.
 *
 * It mirrors the surfaces and interaction of the real workspace: folders and
 * views on the left, searchable notes in the middle, a rich note with circular
 * checklists and a floating dock on the right. All state is local and fake.
 */
import { useState } from "react";
import {
  createDemoState,
  demoFolders,
  demoListTitle,
  demoNotes,
  isDemoChecked,
  selectDemoArchive,
  selectDemoFolder,
  selectDemoNote,
  selectedDemoNote,
  setDemoQuery,
  toggleDemoCheck,
  visibleDemoNotes,
} from "./demo-state";

function IconNote() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8l4 4v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M10 10h6M10 14h6M10 18h4" />
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

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
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

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2.4 6.3 2.3 2.3 4.9-5" />
    </svg>
  );
}

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

export function ProductDemo() {
  const [state, setState] = useState(createDemoState);
  const note = selectedDemoNote(state);
  const notes = visibleDemoNotes(state);
  const listTitle = demoListTitle(state);
  const archiveCount = demoNotes.filter((item) => item.archived).length;
  const allCount = demoNotes.filter((item) => !item.archived).length;

  return (
    <div className="demo-frame">
      <div className="demo-chrome" aria-hidden="true">
        <span className="demo-chrome-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="demo-chrome-title">Notty</span>
        <span className="demo-chrome-meta">
          <span className="demo-live-dot" /> local vault
        </span>
      </div>

      <div className="product-demo" data-testid="product-demo">
        <aside className="demo-sidebar" aria-label="Folders" data-column="sidebar">
          <div className="demo-wordmark">Notty</div>

          <div className="demo-side-group">
            <p className="demo-side-heading">Library</p>
            <button
              type="button"
              className={`demo-side-item${state.view === "all" && state.folder === null ? " is-active" : ""}`}
              aria-current={state.view === "all" && state.folder === null ? "page" : undefined}
              onClick={() => setState(selectDemoFolder(state, null))}
            >
              <IconNote />
              <span>All Notes</span>
              <span className="demo-side-count">{allCount}</span>
            </button>
            <button
              type="button"
              className={`demo-side-item${state.view === "archive" ? " is-active" : ""}`}
              aria-current={state.view === "archive" ? "page" : undefined}
              onClick={() => setState(selectDemoArchive(state))}
            >
              <IconArchive />
              <span>Archive</span>
              <span className="demo-side-count">{archiveCount}</span>
            </button>
          </div>

          <div className="demo-side-group">
            <div className="demo-side-heading-row">
              <p className="demo-side-heading">Folders</p>
              <span className="demo-side-add" aria-hidden="true">+</span>
            </div>
            {demoFolders.map((folder) => {
              const active = state.view === "all" && state.folder === folder;
              return (
                <button
                  key={folder}
                  type="button"
                  className={`demo-side-item${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setState(selectDemoFolder(state, folder))}
                >
                  <IconFolder />
                  <span>{folder}</span>
                  <span className="demo-side-count">
                    {demoNotes.filter(
                      (item) => !item.archived && item.folder === folder,
                    ).length}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="demo-side-footer">
            <button
              type="button"
              className="demo-side-item"
              onClick={() => setState(selectDemoFolder(state, null))}
            >
              <IconTrash />
              <span>Trash</span>
            </button>
            <div className="demo-quick-capture">
              <span>Quick Capture</span>
              <kbd>Ctrl+Shift+Space</kbd>
            </div>
          </div>
        </aside>

        <section className="demo-list" aria-label="Note list" data-column="note-list">
          <header className="demo-list-head">
            <h3>{listTitle}</h3>
            <button type="button" className="demo-compose" aria-label="New note" title="New note (Ctrl+N)">
              <IconPlus />
            </button>
          </header>

          <div className="demo-search">
            <IconSearch />
            <input
              type="search"
              value={state.query}
              aria-label="Search notes"
              placeholder="Search notes (FTS5 < 2ms)…"
              onChange={(event) => setState(setDemoQuery(state, event.target.value))}
            />
          </div>

          <div className="demo-rows" role="list">
            {notes.map((item) => {
              const active = note?.id === item.id;
              return (
                <div key={item.id} role="listitem" className={`demo-note${active ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="demo-note-main"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setState(selectDemoNote(state, item.id))}
                  >
                    <span className="demo-note-title-row">
                      <span className="demo-note-title">{item.title}</span>
                      {item.pinned ? <span className="demo-pin">★ Pinned</span> : null}
                    </span>
                    <span className="demo-note-meta">
                      <time dateTime={item.modified}>{item.modified}</time>
                      <span className="demo-folder-chip">{item.folder}</span>
                    </span>
                  </button>
                </div>
              );
            })}
            {notes.length === 0 ? (
              <p className="demo-empty">No notes match.</p>
            ) : null}
          </div>
        </section>

        <section className="demo-editor" aria-label="Editor" data-column="editor">
          {note === null ? (
            <div className="demo-editor-empty">
              <h3>Select a note</h3>
              <p>Pick a note from the list, or press Ctrl+N to start one.</p>
            </div>
          ) : (
            <>
              <div className="demo-editor-head">
                <p className="demo-timestamps">
                  Created {note.created} <span aria-hidden="true">·</span> Edited{" "}
                  <span className="demo-num">{note.modified}</span>
                </p>
                <span className="demo-path">{note.path}</span>
              </div>

              <div className="demo-editor-scroll">
                <h3 className="demo-note-heading">{note.title}</h3>
                <p className="demo-intro">{note.intro}</p>

                <ul className="demo-checklist" aria-label="Checklist">
                  {note.checklist.map((item) => {
                    const checked = isDemoChecked(state, note, item);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          className="demo-checkbox"
                          onClick={() => setState(toggleDemoCheck(state, note, item))}
                        >
                          <span className="demo-check-ring" aria-hidden="true">
                            <IconCheck />
                          </span>
                          <span className="demo-check-label">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {note.table === undefined ? null : (
                  <table className="demo-table">
                    <thead>
                      <tr>
                        {note.table.columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {note.table.rows.map((row) => (
                        <tr key={row.join("/")}>
                          {row.map((cell) => (
                            <td key={cell}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {note.attachment === undefined ? null : (
                  <div className="demo-attachment">
                    <span className="demo-attachment-thumb" aria-hidden="true">
                      <IconImage />
                    </span>
                    <span className="demo-attachment-body">
                      <span className="demo-attachment-name">{note.attachment.name}</span>
                      <span className="demo-attachment-meta">{note.attachment.meta}</span>
                    </span>
                    <span className="demo-attachment-kind">PNG</span>
                  </div>
                )}
              </div>

              <div className="demo-dock note-editor-dock" role="toolbar" aria-label="Formatting">
                <button
                  type="button"
                  className={`demo-dock-btn${note.checklist[0] !== undefined && isDemoChecked(state, note, note.checklist[0]) ? " is-active" : ""}`}
                  aria-label="Checklist"
                  title="Checklist"
                  onClick={() => {
                    const first = note.checklist[0];
                    if (first !== undefined) {
                      setState(toggleDemoCheck(state, note, first));
                    }
                  }}
                >
                  <IconChecklist />
                </button>
                <button type="button" className="demo-dock-btn demo-dock-text" aria-label="Bold" title="Bold">
                  B
                </button>
                <button type="button" className="demo-dock-btn demo-dock-text demo-dock-italic" aria-label="Italic" title="Italic">
                  I
                </button>
                <button type="button" className="demo-dock-btn demo-dock-text" aria-label="Heading 2" title="Heading 2">
                  H2
                </button>
                <button type="button" className="demo-dock-btn" aria-label="Table" title="Insert table">
                  <IconTable />
                </button>
                <button type="button" className="demo-dock-btn" aria-label="Image" title="Insert image">
                  <IconImage />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
