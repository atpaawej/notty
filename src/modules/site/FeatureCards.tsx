/**
 * Private: the four bento cards and their raw inline SVG product animations.
 *
 * Every animation is CSS on `transform`, `opacity` or `clip-path`. The SVG's
 * resting state is the finished frame, so `prefers-reduced-motion: reduce`
 * can remove the loop without leaving an empty or half-drawn card.
 */
import type { ReactNode } from "react";

function CaptureSvg() {
  return (
    <svg
      className="feature-svg"
      viewBox="0 0 600 320"
      role="img"
      aria-labelledby="feature-capture-title"
    >
      <title id="feature-capture-title">
        Quick Capture hotkey opening a note while Auto-title and Auto-save run
      </title>
      <rect className="site-panel" x="1" y="1" width="598" height="318" rx="14" />

      <g className="capture-pill">
        <rect x="178" y="22" width="244" height="32" rx="16" className="site-surface" />
        <text x="300" y="42" textAnchor="middle" className="site-svg-mono site-svg-strong">
          Ctrl + Shift + Space
        </text>
      </g>
      <circle className="capture-ring" cx="300" cy="38" r="34" />

      <g className="capture-card">
        <rect x="96" y="78" width="408" height="136" rx="12" className="site-surface" />
        <text x="118" y="104" className="site-svg-mono site-svg-muted">
          Quick capture
        </text>
        <text x="118" y="130" className="site-svg-ui site-svg-strong">
          Write the RFC for the sync engine
        </text>
        <rect x="118" y="148" width="312" height="6" rx="3" className="site-bar" />
        <rect x="118" y="162" width="246" height="6" rx="3" className="site-bar" />
        <text x="118" y="190" className="site-svg-mono site-svg-muted">
          Auto-title
        </text>
        <rect x="118" y="198" width="280" height="6" rx="3" className="site-bar" />
        <rect className="capture-fill" x="118" y="198" width="280" height="6" rx="3" />
        <rect className="capture-caret" x="371" y="120" width="2" height="15" rx="1" />
      </g>

      <g className="write-pipeline">
        <text x="96" y="244" className="site-svg-mono site-svg-muted">
          Auto-save
        </text>
        <rect x="186" y="228" width="66" height="24" rx="12" className="site-surface" />
        <text x="219" y="244" textAnchor="middle" className="site-svg-mono">
          .tmp
        </text>
        <circle className="write-dot write-dot-1" cx="264" cy="240" r="2.5" />
        <rect x="276" y="228" width="72" height="24" rx="12" className="site-surface" />
        <text x="312" y="244" textAnchor="middle" className="site-svg-mono">
          fsync
        </text>
        <circle className="write-dot write-dot-2" cx="362" cy="240" r="2.5" />
        <rect x="374" y="228" width="66" height="24" rx="12" className="site-surface" />
        <text x="407" y="244" textAnchor="middle" className="site-svg-mono">
          .md
        </text>
        <text x="456" y="244" className="site-svg-mono site-svg-muted">
          400 ms
        </text>
      </g>

      <text x="96" y="292" className="site-svg-mono site-svg-muted">
        File first, Index second.
      </text>
    </svg>
  );
}

function EditorSvg() {
  return (
    <svg
      className="feature-svg"
      viewBox="0 0 600 320"
      role="img"
      aria-labelledby="feature-editor-title"
    >
      <title id="feature-editor-title">
        Circular checklist completing, an attachment and the floating formatting dock
      </title>
      <rect className="site-panel" x="1" y="1" width="598" height="318" rx="14" />
      <text x="40" y="32" className="site-svg-mono site-svg-muted">
        work/rfc-sync--4f2a.md
      </text>
      <rect x="24" y="44" width="552" height="248" rx="12" className="site-surface" />

      <g className="check-row">
        <circle cx="58" cy="82" r="9" className="site-check-ring" />
        <circle className="check-fill" cx="58" cy="82" r="9" />
        <path className="check-mark" d="M53.5 82.5 56.8 85.8 63.5 78.6" />
        <text x="80" y="87" className="site-svg-ui">
          Write the file before the Index row
        </text>
        <line className="check-strike" x1="80" y1="83" x2="265" y2="83" />
      </g>
      <g className="check-row">
        <circle cx="58" cy="114" r="9" className="site-check-ring" />
        <text x="80" y="119" className="site-svg-ui">
          Cover open-note reconciliation
        </text>
      </g>

      <g className="editor-attachment">
        <rect x="42" y="146" width="242" height="60" rx="10" className="site-surface" />
        <rect x="52" y="156" width="40" height="40" rx="6" fill="#252526" />
        <circle cx="62" cy="166" r="2.4" fill="#71717a" />
        <path d="m55 188 8-8 6 6 5-5 9 9" fill="none" stroke="#71717a" strokeWidth="1.4" />
        <text x="104" y="169" className="site-svg-mono site-svg-muted">
          attachments/
        </text>
        <text x="104" y="184" className="site-svg-mono">
          7d1c9e4a.png
        </text>
        <text x="104" y="198" className="site-svg-ui site-svg-muted">
          PNG · 148 KB
        </text>
      </g>

      <g className="editor-table">
        <rect x="300" y="146" width="252" height="60" rx="10" className="site-surface" />
        <text x="314" y="168" className="site-svg-mono site-svg-muted">
          Table
        </text>
        <g className="table-cell">
          <rect x="314" y="178" width="56" height="12" rx="2" />
          <rect x="376" y="178" width="56" height="12" rx="2" />
          <rect x="438" y="178" width="56" height="12" rx="2" />
        </g>
        <g className="table-cell table-cell-2">
          <rect x="314" y="194" width="56" height="6" rx="2" />
          <rect x="376" y="194" width="56" height="6" rx="2" />
          <rect x="438" y="194" width="56" height="6" rx="2" />
        </g>
      </g>

      <g className="editor-dock">
        <rect x="176" y="238" width="248" height="42" rx="21" className="site-dock" />
        <g className="dock-checklist">
          <rect x="188" y="251" width="12" height="12" rx="3" />
          <path d="m190 257 2 2 3-4" />
        </g>
        <text x="216" y="262" textAnchor="middle" className="site-svg-ui site-svg-strong">B</text>
        <text x="242" y="262" textAnchor="middle" className="site-svg-ui site-svg-muted">I</text>
        <text x="270" y="262" textAnchor="middle" className="site-svg-ui">H2</text>
        <g className="dock-table">
          <rect x="288" y="250" width="15" height="13" rx="2" />
          <path d="M288 255h15M295 250v13" />
        </g>
        <g className="dock-image">
          <rect x="315" y="250" width="15" height="13" rx="2" />
          <circle cx="320" cy="254" r="1.2" />
          <path d="m316 261 4-4 3 3 2-2 3 3" />
        </g>
        <rect x="348" y="248" width="1" height="20" fill="rgba(255,255,255,.12)" />
        <text x="380" y="262" textAnchor="middle" className="site-svg-mono site-svg-muted">
          Ctrl N
        </text>
      </g>
    </svg>
  );
}

function StorageSvg() {
  return (
    <svg
      className="feature-svg"
      viewBox="0 0 600 320"
      role="img"
      aria-labelledby="feature-storage-title"
    >
      <title id="feature-storage-title">
        A Markdown note with YAML Frontmatter syncing with the SQLite FTS5 Index
      </title>
      <rect className="site-panel" x="1" y="1" width="598" height="318" rx="14" />

      <g className="file-card">
        <rect x="24" y="24" width="246" height="248" rx="12" className="site-surface" />
        <text x="42" y="50" className="site-svg-mono site-svg-strong">
          work/rfc-sync.md
        </text>
        <line x1="42" y1="60" x2="252" y2="60" stroke="rgba(255,255,255,.08)" />
        <text x="42" y="82" className="site-svg-mono site-svg-muted">---</text>
        <text x="42" y="100" className="site-svg-mono">
          <tspan className="site-svg-muted">id:</tspan> 0f9c2b7e
        </text>
        <text x="42" y="118" className="site-svg-mono">
          <tspan className="site-svg-muted">folder:</tspan> work
        </text>
        <text x="42" y="136" className="site-svg-mono">
          <tspan className="site-svg-muted">pinned:</tspan>{" "}
          <tspan fill="#f59e0b">true</tspan>
        </text>
        <text x="42" y="154" className="site-svg-mono site-svg-muted">---</text>
        <text x="42" y="180" className="site-svg-ui">
          Two writers, one vault.
        </text>
        <rect x="42" y="194" width="196" height="6" rx="3" className="site-bar" />
        <rect x="42" y="208" width="160" height="6" rx="3" className="site-bar" />
        <rect x="42" y="222" width="184" height="6" rx="3" className="site-bar" />
        <text x="42" y="252" className="site-svg-mono site-svg-muted">
          Markdown · authoritative
        </text>
      </g>

      <g className="index-card">
        <rect x="330" y="24" width="246" height="248" rx="12" className="site-surface" />
        <text x="348" y="50" className="site-svg-mono site-svg-strong">
          notty.db
        </text>
        <rect x="468" y="36" width="88" height="18" rx="9" className="site-pill" />
        <text x="512" y="49" textAnchor="middle" className="site-svg-mono site-svg-muted">
          FTS5 · WAL
        </text>
        <g className="index-row">
          <rect x="348" y="68" width="210" height="26" rx="6" />
          <text x="358" y="85" className="site-svg-mono">rfc-sync</text>
          <text x="538" y="85" textAnchor="end" className="site-svg-mono site-svg-muted">1.4ms</text>
        </g>
        <g className="index-row index-row-2">
          <rect x="348" y="100" width="210" height="26" rx="6" />
          <text x="358" y="117" className="site-svg-mono">weekly-review</text>
          <text x="538" y="117" textAnchor="end" className="site-svg-mono site-svg-muted">0.9ms</text>
        </g>
        <g className="index-row index-row-3">
          <rect x="348" y="132" width="210" height="26" rx="6" />
          <text x="358" y="149" className="site-svg-mono">groceries</text>
          <text x="538" y="149" textAnchor="end" className="site-svg-mono site-svg-muted">1.1ms</text>
        </g>
        <text x="348" y="188" className="site-svg-mono site-svg-muted">query latency</text>
        <text x="348" y="212" className="site-svg-ui site-svg-strong">Delete it. Rebuild it.</text>
        <text x="348" y="230" className="site-svg-ui site-svg-muted">The vault is the source.</text>
        <text x="348" y="254" className="site-svg-mono site-svg-muted">WAL · busy timeout</text>
      </g>

      <path d="M274 112h52" stroke="rgba(41,151,255,.35)" strokeWidth="1.2" />
      <path d="m320 108 6 4-6 4" fill="none" stroke="rgba(41,151,255,.6)" strokeWidth="1.2" />
      <text x="300" y="100" textAnchor="middle" className="site-svg-mono site-svg-muted">inotify</text>
      <text x="300" y="126" textAnchor="middle" className="site-svg-mono site-svg-muted">{"50 ms"}</text>
      <circle className="packet packet-right" cx="278" cy="112" r="2.6" />

      <path d="M326 196h-52" stroke="rgba(40,200,64,.35)" strokeWidth="1.2" />
      <path d="m280 192-6 4 6 4" fill="none" stroke="rgba(40,200,64,.55)" strokeWidth="1.2" />
      <text x="300" y="184" textAnchor="middle" className="site-svg-mono site-svg-muted">query</text>
      <text x="300" y="210" textAnchor="middle" className="site-svg-mono site-svg-muted">1.4ms</text>
      <circle className="packet packet-left" cx="324" cy="196" r="2.6" />

      <text x="24" y="300" className="site-svg-mono site-svg-muted">
        Frontmatter travels with the file. The Index is derived.
      </text>
    </svg>
  );
}

function CliSvg() {
  return (
    <svg
      className="feature-svg"
      viewBox="0 0 600 320"
      role="img"
      aria-labelledby="feature-cli-title"
    >
      <title id="feature-cli-title">
        The notty CLI installing an Agent Skill and creating a note that appears in the GUI
      </title>
      <rect className="site-panel" x="1" y="1" width="598" height="318" rx="14" />

      <g className="terminal">
        <rect x="20" y="20" width="352" height="280" rx="12" fill="#0a0a0a" stroke="rgba(255,255,255,.11)" />
        <line x1="20" y1="48" x2="372" y2="48" stroke="rgba(255,255,255,.08)" />
        <circle cx="36" cy="34" r="3" fill="#ff5f57" />
        <circle cx="48" cy="34" r="3" fill="#febc2e" />
        <circle cx="60" cy="34" r="3" fill="#28c840" />
        <text x="356" y="37" textAnchor="end" className="site-svg-mono site-svg-muted">agent skill</text>

        <text x="38" y="78" className="site-svg-mono terminal-line terminal-line-1">
          <tspan fill="#2997ff">$</tspan> notty skill install
        </text>
        <text x="38" y="98" className="site-svg-mono terminal-line terminal-line-2" fill="#28c840">
          ✓ skill installed
        </text>
        <text x="38" y="126" className="site-svg-mono terminal-line terminal-line-3">
          <tspan fill="#2997ff">$</tspan> notty create --title &quot;RFC: Sync&quot;
        </text>
        <text x="38" y="144" className="site-svg-mono terminal-line terminal-line-3" fill="#a1a1aa">
          {"    --folder work --json"}
        </text>
        <text x="38" y="166" className="site-svg-mono terminal-line terminal-line-4" fill="#f59e0b">
          {'{ "id": "4f2a", "folder": "work" }'}
        </text>
        <text x="38" y="192" className="site-svg-mono terminal-line terminal-line-5" fill="#2997ff">
          $
        </text>
        <rect className="terminal-cursor" x="50" y="182" width="7" height="12" rx="1" fill="#f5f5f7" />
        <text x="38" y="238" className="site-svg-mono site-svg-muted terminal-line terminal-line-5">
          same vault
        </text>
        <text x="38" y="256" className="site-svg-mono site-svg-muted terminal-line terminal-line-5">
          SQLite WAL · concurrent reads
        </text>
        <text x="38" y="274" className="site-svg-mono site-svg-muted terminal-line terminal-line-5">
          --json for scripts
        </text>
      </g>

      <g className="cli-list">
        <rect x="388" y="20" width="192" height="280" rx="12" fill="#252526" stroke="rgba(255,255,255,.11)" />
        <text x="404" y="50" className="site-svg-ui site-svg-strong">work</text>
        <circle cx="560" cy="45" r="8" fill="rgba(41,151,255,.16)" />
        <path d="M560 41v8M556 45h8" stroke="#2997ff" strokeWidth="1.3" strokeLinecap="round" />
        <rect x="404" y="64" width="160" height="22" rx="6" fill="#1c1c1e" stroke="rgba(255,255,255,.07)" />
        <text x="414" y="79" className="site-svg-mono site-svg-muted">Search</text>
        <line x1="388" y1="96" x2="580" y2="96" stroke="rgba(255,255,255,.06)" />

        <g className="cli-row cli-row-1">
          <text x="404" y="118" className="site-svg-ui">Weekly review</text>
          <text x="404" y="132" className="site-svg-mono site-svg-muted">1h ago</text>
        </g>
        <g className="cli-new-row">
          <rect x="394" y="146" width="180" height="46" rx="7" fill="#37373d" />
          <text x="404" y="166" className="site-svg-ui site-svg-strong">RFC: Sync</text>
          <text x="404" y="181" className="site-svg-mono site-svg-muted">now</text>
          <rect x="500" y="156" width="40" height="16" rx="8" fill="rgba(41,151,255,.16)" />
          <text x="520" y="167" textAnchor="middle" className="site-svg-mono" fill="#2997ff">work</text>
        </g>
        <g className="cli-row cli-row-3">
          <text x="404" y="218" className="site-svg-ui site-svg-muted">Release 0.2.8</text>
          <text x="404" y="232" className="site-svg-mono site-svg-muted">Oct 28</text>
        </g>

        <line x1="388" y1="248" x2="580" y2="248" stroke="rgba(255,255,255,.06)" />
        <circle className="wal-dot" cx="406" cy="270" r="3" fill="#28c840" />
        <text x="418" y="274" className="site-svg-mono site-svg-muted">SQLite WAL</text>
      </g>
    </svg>
  );
}

interface FeatureCardProps {
  readonly feature: string;
  readonly span: "span-5" | "span-7";
  readonly chip: ReactNode;
  readonly title: string;
  readonly body: ReactNode;
  readonly children: ReactNode;
}

function FeatureCard({ feature, span, chip, title, body, children }: FeatureCardProps) {
  return (
    <article
      className={`bento-card ${span}`}
      data-testid="feature-card"
      data-feature={feature}
    >
      <div className="bento-copy">
        <span className="bento-chip">{chip}</span>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="bento-visual">{children}</div>
    </article>
  );
}

export function FeatureCards() {
  return (
    <div className="bento-grid">
      <FeatureCard
        feature="capture"
        span="span-7"
        chip={<><kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Space</kbd></>}
        title="Capture before the thought leaves"
        body="The note opens with the cursor in the body. Auto-title fills in the first words, and Auto-save writes the Markdown file while you keep typing."
      >
        <CaptureSvg />
      </FeatureCard>

      <FeatureCard
        feature="editor"
        span="span-5"
        chip={<code>.note-editor-dock</code>}
        title="A rich editor that stays out of the way"
        body="Circular checklists, tables, headings and inline images. Paste a screenshot and the Attachment lands in attachments/ with a relative path in the note."
      >
        <EditorSvg />
      </FeatureCard>

      <FeatureCard
        feature="storage"
        span="span-5"
        chip={<code>notty.db</code>}
        title="Markdown first, Index second"
        body="Every note is a file with YAML Frontmatter. SQLite FTS5 answers search, and a Rebuild restores the Index from the vault whenever you delete it."
      >
        <StorageSvg />
      </FeatureCard>

      <FeatureCard
        feature="cli"
        span="span-7"
        chip={<code>notty create --json</code>}
        title="The same vault from a shell"
        body="The CLI creates, reads and searches the notes the desktop window already has open. notty skill install puts the bundled Agent Skill where coding agents look."
      >
        <CliSvg />
      </FeatureCard>
    </div>
  );
}
