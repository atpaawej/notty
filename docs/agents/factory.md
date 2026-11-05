# The Notty Software Factory

Triggers, not humans, start agent sessions. You label an issue, the factory implements it and opens a draft PR. You review and merge — a human always merges. Nothing in this system merges to `main` on its own.

This is the single-issue loop, plus the queue. Wider loops (automated review, PRD chaining) come after we trust this one.

## The labels (state machine)

| Label | Applied by | Meaning |
| ----- | ---------- | ------- |
| `ready-for-agent` | you (triage) | Fully specified; the triage signal. Not a trigger. |
| `agent:implement` | you, or Promote Queued | **The trigger.** A factory run implements the issue now. |
| `agent:queued` | you | Trigger when the last blocker closes. The label *is* the authorization. |
| `agent:in-progress` | factory | Lock. A run holds it; do not re-trigger. |
| `agent:blocked` | factory | Failed or refused; needs a human before retry. |
| `agent:review`, `agent:update-branch` | — | Reserved; not yet implemented. |

## The two workflows

**Agent · Implement** (`.github/workflows/agent-implement.yml`) — on `issues: labeled` with `agent:implement`, or manual `workflow_dispatch`.

1. **Preflight** — refuses (comment + `agent:blocked`) if the issue is closed, already `agent:in-progress`, or has open native blockers (`blocked_by`). Otherwise removes `agent:implement`, adds `agent:in-progress`.
2. **Setup** — checkout `main`, branch `agent/issue-<N>-<slug>`, Node 24, `npm ci`, pinned opencode 2.2.5.
3. **Agent** — opencode with `opencode/deepseek-v4.1-flash-free`. The agent gets a **scrubbed environment** (`env -i`): no `GITHUB_TOKEN`. It edits code, runs the checks, and commits (`Part of #N: ...`). It is told not to push or touch GitHub.
4. **Orchestrator** — commits any leftovers, verifies at least one commit ahead of `main`, pushes `--force` (deterministic branch), opens a **draft** PR with `Closes #N`, comments the PR link on the issue.
5. **Failure** (`failure()`) — `agent:blocked` + comment linking the run and, when known, why. **Always** — `agent:in-progress` is removed.

**Agent · Promote Queued** (`.github/workflows/agent-promote-queued.yml`) — on `issues: closed` (completed). For every open `agent:queued` issue with zero open `blocked_by` dependencies and no `agent:in-progress`: remove `agent:queued`, add `agent:implement`, dispatch the Implement workflow via `workflow_dispatch` (this event type is allowed for `GITHUB_TOKEN`). Falls back to a comment with the manual command if dispatch fails.

## Trust boundaries

- **The agent never holds a GitHub token.** All GitHub mutations happen in orchestrator steps, around the agent.
- **CI is the leash.** The agent is told the four checks must pass; the draft PR shows CI status; you see red before you review.
- **The model is free and anonymous** (DeepSeek V4.1 Flash Free via opencode — no API key, no account, limited time, limited context, no SLA). The repo is public and MIT, but nothing here may ever carry secrets; there are none.
- **Merges are human.** Always.
- Push uses `--force` on a deterministic per-issue branch only.

## Operations

**Run it on an issue**

```bash
gh issue edit <N> --add-label agent:implement
```

**Fire it manually without a label**

```bash
gh workflow run agent-implement.yml -f issue_number=<N>
```

**Retry after a failure**

Read the run the `agent:blocked` comment links to. Fix the cause (usually a failing check or an impossible task), then `gh issue edit <N> --add-label agent:implement`.

**Stop everything** — GitHub → Actions → the workflow → Disable workflow. Or per issue: remove `agent:implement`; a running job finishes but no new one starts. `agent:in-progress` never auto-expires; remove it if a runner died mid-flight.

**Why the draft PR is draft** — a factory PR is a starting point for review, not a finished product. Convert to ready-for-review only after you've read the diff and CI is green.

## Costs

$0. Free models + public-repo Actions minutes. The real cost is review attention. If anonymous access gets rate-limited or the free tier disappears, the documented fallback is the $10/mo OpenCode Go plan with `OPENCODE_API_KEY` as a repo secret — the workflow needs one line changed.

## What this is not (yet)

- No automated review loop (`agent:review`) — the next widening step, after a few PRs show how much review the agent actually needs.
- No PRD chaining — each sub-issue of #1 is its own `agent:implement`; Promote Queued does the ordering via native blockers.
- No self-merge, ever.
