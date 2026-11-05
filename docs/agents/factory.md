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
3. **Agent** — opencode with `opencode/deepseek-v4.1-flash-free`. The agent gets a **scrubbed environment** (`env -i`): no `GITHUB_TOKEN`. It edits code, runs the checks, and commits (`Part of #N: ...`). It is told not to push or touch GitHub. Before finishing it writes the PR description to `/tmp/factory-pr-body.md`.
4. **Orchestrator** — commits any leftovers, fetches and rebases onto `main`, verifies at least one commit ahead, pushes `--force` (deterministic branch), opens a **draft** PR with `Closes #N` through the REST API (reusing an existing open PR), and comments the PR link on the issue. PR creation is non-fatal: if the API refuses, the pushed branch is the deliverable, and the issue gets the exact `gh pr create` command instead of a false `agent:blocked`.
5. **Failure** (`failure()`) — `agent:blocked` + comment linking the run and, when known, why. **Always** — `agent:in-progress` is removed.

**Agent · Promote Queued** (`.github/workflows/agent-promote-queued.yml`) — on `issues: closed` (completed). For every open `agent:queued` issue with zero open `blocked_by` dependencies and no `agent:in-progress`: remove `agent:queued`, add `agent:implement`, dispatch the Implement workflow via `workflow_dispatch` (this event type is allowed for `GITHUB_TOKEN`). Falls back to a comment with the manual command if dispatch fails.

## PR descriptions

A reviewer should not have to reconstruct intent from a diff. The agent writes `/tmp/factory-pr-body.md` before it stops — the one moment when it still remembers what it tried, what it skipped, and what it decided. If its tools cannot write outside the repo it uses `.factory-pr-body.md` in the root instead; the catch-all commit step moves that out before staging, so it never reaches the branch. `.github/scripts/build-pr-body.sh` renders it.

The agent's file must use these headings: **Summary**, **What changed**, **Decisions and deviations**, **Verification**, **Gaps and follow-ups**, **Review guide**.

The script owns everything the agent must not:

- The first line, `Closes #N`. Only the orchestrator may close an issue.
- Closing keywords in agent prose are neutralised — `fixes #12` becomes `fixes ~~#12~~`, so agent text can never close another issue on merge.
- `## Files changed` (diffstat), the model, and the run link are appended mechanically, so the body always carries facts.

Failure handling: no file, no `## Summary`, or under 300 characters → the body falls back to the commit list plus diffstat, and the issue comment says the description is missing. The body is capped at 4,000 characters, cut on a line or word boundary. On a re-run that finds an existing PR, the body is refreshed over `PATCH`.

## Trust boundaries

- **The agent never holds a GitHub token.** All GitHub mutations happen in orchestrator steps, around the agent.
- **CI is the leash.** The agent is told the four checks must pass; the draft PR shows CI status; you see red before you review.
- **The model is account-authenticated free tier** (`OPENCODE_API_KEY`, zero credits; verified from hosted runners). Anonymous access does not work from Azure IPs. Free models are limited-time and the pool can exhaust — CI is the leash, no SLA. The repo is public and MIT; nothing here may ever carry other secrets.
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

A failed run **consumes** `agent:implement` (it is removed alongside the `agent:blocked` label). Read the run the comment links to — on an agent stall the comment also carries why the agent produced no work. Fix the cause (usually a failing check or an impossible task), then `gh issue edit <N> --add-label agent:implement`.

**Stop everything** — GitHub → Actions → the workflow → Disable workflow. Or per issue: remove `agent:implement`; a running job finishes but no new one starts. `agent:in-progress` never auto-expires; remove it if a runner died mid-flight.

**Why the draft PR is draft** — a factory PR is a starting point for review, not a finished product. Convert to ready-for-review only after you've read the diff and CI is green.

## Setup (required once)

**Workflow permissions** — GitHub forbids `GITHUB_TOKEN` from creating PRs out of the box. With read-only permissions the agent runs fine but the PR step dies with `GitHub Actions is not permitted to create or approve pull requests`. Fix: repo **Settings → Actions → General → Workflow permissions → "Read and write permissions"** and tick **"Allow GitHub Actions to create and approve pull requests"**, or via API:

```bash
gh api --method PUT repos/<owner>/<repo>/actions/permissions/workflow \
  -F default_workflow_permissions=write -F can_approve_pull_request_reviews=true
```

**Model access** — the anonymous free tier is exhausted on GitHub-hosted (Azure) IPs: every run dies with `Free usage limit reached`. The factory authenticates the free tier as an account via the `OPENCODE_API_KEY` repo secret instead (agent step only; zero-credit console account — free-tier models only). Verified: signed-in runs work from Actions. If the free pool ever dries up entirely, the run fails loudly with `agent:blocked` and the fallback is a few dollars of Console credit (`opencode/deepseek-v4.1-flash`, paid) or Go.

## Costs

$0 — free-tier models via a zero-credit account, plus public-repo Actions minutes. The real cost is review attention. The anonymous tier was tried first and does not work from hosted runners; paid fallback exists in one line if the free pool vanishes.

## What this is not (yet)

- No automated review loop (`agent:review`) — the next widening step, after a few PRs show how much review the agent actually needs.
- No PRD chaining — each sub-issue of #1 is its own `agent:implement`; Promote Queued does the ordering via native blockers.
- No self-merge, ever.
