/**
 * Private: the landing page.
 *
 * Presentation only. It imports no runtime module: the page can ship as a
 * static site without dragging the desktop app, TipTap or the CLI into the
 * bundle. Product claims come from docs/SPEC.md and docs/STORAGE.md.
 */
import { useEffect, useRef, useState } from "react";
import "./site.css";
import { FeatureCards } from "./FeatureCards";
import { ProductDemo } from "./ProductDemo";

const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/atpaawej/notty/main/install.sh | sh";
const GITHUB_URL = "https://github.com/atpaawej/notty";

function NottyMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3.5h7.2L18 7.3V20a.6.6 0 0 1-.6.6H7a.6.6 0 0 1-.6-.6V4.1a.6.6 0 0 1 .6-.6Z" />
      <path d="M14 3.8V7.5h3.7M9.5 12h5M9.5 15.5h3.5" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2.4a9.7 9.7 0 0 0-3.1 18.9c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.1c0 .3.2.6.7.5A9.7 9.7 0 0 0 12 2.4Z" />
    </svg>
  );
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
      } else {
        const field = document.createElement("textarea");
        field.value = INSTALL_COMMAND;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="command-block" data-testid="install-command">
      <code className="command-code">
        <span className="command-prompt" aria-hidden="true">$</span>
        {INSTALL_COMMAND}
      </code>
      <button
        type="button"
        className={`copy-button${copied ? " is-copied" : ""}`}
        onClick={() => void copy()}
        aria-label={copied ? "Installer command copied" : "Copy installer command"}
      >
        <span className="copy-button-idle" aria-hidden="true">Copy</span>
        <span className="copy-button-confirm" aria-hidden="true">✓ Copied</span>
      </button>
      <span className="visually-hidden" role="status">
        {copied ? "Installer command copied" : ""}
      </span>
    </div>
  );
}

function SiteNav() {
  return (
    <header className="site-nav">
      <div className="wrap nav-inner">
        <a className="brand" href="#product" aria-label="Notty home">
          <span className="brand-mark"><NottyMark /></span>
          <span className="brand-name">Notty</span>
          <span className="brand-version">v0.2.8</span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#product">Product</a>
          <a href="#features">Features</a>
          <a href="#storage">Storage</a>
          <a href="#cli">CLI</a>
        </nav>
        <div className="nav-actions">
          <a className="nav-github" href={GITHUB_URL} aria-label="Notty on GitHub">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <a className="btn btn-primary btn-sm" href="#install">Install</a>
        </div>
      </div>
    </header>
  );
}

function StorageSection() {
  return (
    <section className="section storage-section" id="storage">
      <div className="wrap">
        <div className="section-head">
          <h2>The Index is disposable. The Vault is not.</h2>
          <p className="lead">
            SQLite mirrors Frontmatter and note bodies for listing and search.
            Deleting notty.db is safe: the next launch reads the Markdown files and
            Rebuilds the Index from them.
          </p>
        </div>

        <div className="storage-grid">
          <div className="storage-details">
            <article className="detail-row">
              <h3>Frontmatter stays with the file</h3>
              <p>
                Identity, title, timestamps, Pin and Archive flags live at the top
                of every note. Unknown keys survive a write from an older build.
              </p>
            </article>
            <article className="detail-row">
              <h3>Search reads the Index</h3>
              <p>
                Listing and full-text search never re-parse the vault. SQLite FTS5
                indexes titles and bodies, and the search field waits 150 ms for
                you to stop typing.
              </p>
            </article>
            <article className="detail-row">
              <h3>One write order</h3>
              <p>
                The file is written first, the Index second. If the two disagree,
                the Markdown file wins. WAL mode lets the CLI write while the
                desktop app is open.
              </p>
            </article>
          </div>

          <div className="storage-stack" aria-label="Note file and Index">
            <div className="code-card">
              <div className="code-head">
                <code>work/rfc-sync--4f2a.md</code>
                <span>Markdown</span>
              </div>
              <pre className="code-pre">{`---
id: 0f9c2b7e-...
title: RFC: Sync engine
folder: work
pinned: true
archived: false
created: 2026-11-12T09:14:00Z
modified: 2026-11-12T09:31:12Z
---

Two writers, one vault. The file is the source.`}</pre>
            </div>

            <div className="storage-connector" aria-hidden="true">
              <span className="storage-line" />
              <span className="storage-connector-label">File first, then Index</span>
              <span className="storage-line" />
            </div>

            <div className="code-card">
              <div className="code-head">
                <code>notty.db</code>
                <span>SQLite FTS5 · WAL</span>
              </div>
              <div className="index-preview">
                <div className="index-preview-row is-head">
                  <span>id</span>
                  <span>title</span>
                  <span>pinned</span>
                  <span>query</span>
                </div>
                <div className="index-preview-row">
                  <span>4f2a</span>
                  <span>RFC: Sync engine</span>
                  <span className="index-bool">true</span>
                  <span className="demo-num">1.4ms</span>
                </div>
                <div className="index-preview-row">
                  <span>a7b3</span>
                  <span>Weekly review</span>
                  <span className="index-bool">false</span>
                  <span className="demo-num">0.9ms</span>
                </div>
                <div className="index-preview-row">
                  <span>9c1d</span>
                  <span>Groceries</span>
                  <span className="index-bool">true</span>
                  <span className="demo-num">1.1ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CliSection() {
  return (
    <section className="section cli-section" id="cli">
      <div className="wrap">
        <div className="section-head">
          <h2>The same Vault from a shell.</h2>
          <p className="lead">
            notty exposes the Note and Folder lifecycle to scripts and coding
            agents. The desktop app and the CLI share one Vault; SQLite WAL mode
            lets them run at the same time.
          </p>
        </div>

        <div className="cli-grid">
          <div className="cli-copy">
            <dl className="command-list">
              <div>
                <dt><code>notty create --title &quot;RFC: Sync&quot; --folder work</code></dt>
                <dd>Create a Note in a Folder and print its id.</dd>
              </div>
              <div>
                <dt><code>notty search &quot;wal&quot;</code></dt>
                <dd>Read matching Notes from the FTS5 Index.</dd>
              </div>
              <div>
                <dt><code>notty skill install</code></dt>
                <dd>Install the bundled Agent Skill for coding agents.</dd>
              </div>
            </dl>
            <p className="cli-note">
              Pass <code>--json</code> for a stable machine-readable shape. The CLI
              works while the desktop window is open.
            </p>
          </div>

          <div className="terminal-panel" aria-label="notty CLI example">
            <div className="terminal-head" aria-hidden="true">
              <span className="terminal-dots"><i /><i /><i /></span>
              <span>notty</span>
              <span className="terminal-cwd">~/vault</span>
            </div>
            <pre className="terminal-body">{`$ notty skill install
Installed the Notty skill with the skills CLI.

$ notty create --title "RFC: Sync" --folder work --json
{
  "id": "4f2a...",
  "title": "RFC: Sync",
  "folder": "work"
}

$ notty search "wal"
4f2a...  RFC: Sync  work  pinned`}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function InstallSection() {
  return (
    <section className="install-section" id="install">
      <div className="install-card">
        <div className="install-copy">
          <h2>Install Notty in one line.</h2>
          <p>
            The installer writes to <code>~/.local</code>, links{" "}
            <code>notty</code> into <code>~/.local/bin</code>, and registers the
            desktop entry. No sudo.
          </p>
        </div>
        <div className="install-action">
          <CopyCommand />
          <a className="btn btn-secondary btn-sm" href={GITHUB_URL}>
            <GitHubIcon />
            Read the source
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-inner">
        <div className="footer-brand">
          <span className="brand-mark"><NottyMark /></span>
          <div>
            <p className="footer-name">Notty</p>
            <p className="footer-note">Local-first notes for Linux. Markdown files you own.</p>
          </div>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <a href={GITHUB_URL}>GitHub</a>
          <a href={`${GITHUB_URL}/issues`}>Issues</a>
          <a href="#install">Install</a>
          <span>MIT</span>
        </nav>
      </div>
    </footer>
  );
}

export function Site() {
  return (
    <div className="site-page">
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteNav />
      <main id="main">
        <section className="hero" id="product">
          <div className="wrap">
            <div className="hero-copy">
              <h1>Every note is a file you can open.</h1>
              <p className="hero-lead">
                Notty is a Linux notes app that writes plain Markdown into one
                Vault. Press <kbd>Ctrl</kbd> <span>+</span> <kbd>Shift</kbd>{" "}
                <span>+</span> <kbd>Space</kbd> from any window, type, and the
                file is on disk before you reach for a save button. Search reads
                a SQLite Index in under two milliseconds.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-lg" href="#install">Install Notty</a>
                <a className="btn btn-secondary btn-lg" href="#features">See the features</a>
              </div>
              <CopyCommand />
              <p className="hero-footnote">Linux x86_64 and aarch64. MIT licensed.</p>
            </div>
            <ProductDemo />
          </div>
        </section>

        <section className="section features-section" id="features">
          <div className="wrap">
            <div className="section-head">
              <h2>Built around the note, not the app.</h2>
              <p className="lead">
                Capture, edit, search and script one Markdown Vault. Each card
                below is the real interface, moving.
              </p>
            </div>
            <FeatureCards />
          </div>
        </section>

        <StorageSection />
        <CliSection />
        <InstallSection />
      </main>
      <SiteFooter />
    </div>
  );
}
