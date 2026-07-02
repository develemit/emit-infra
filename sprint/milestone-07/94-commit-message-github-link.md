# Sprint 94 — Deployed commit message + GitHub link

**Difficulty:** 3

## Goal

Capture the commit subject line at CI/deploy time and store it in history. Render each deploy and CI row's SHA as a clickable GitHub link and show the commit message, so "what exactly shipped?" is answerable without leaving the dashboard.

## Reason

Right now the SHA is a dead string in both timelines. The deploy timeline already receives a `repoUrl?` prop (currently unused). Adding the commit message means a glance at the deploy history answers "what changed?" — critical when triaging a regression.

## Context

- `scripts/lib/ci-utils.sh` — `ci_init` and `deploy_init` both call `git rev-parse HEAD` for `_EMIT_SHA`. Add `_EMIT_MSG=$(git log -1 --format="%s" HEAD)` alongside it (line ~67 for ci_init, ~112 for deploy_init). Escape double-quotes before embedding in JSON (`${_EMIT_MSG//\"/\\\"}`).
- `ci_done` writes to `.ci-history.jsonl` (line 101); add `,"message":"%s"` with `$_EMIT_MSG`.
- `deploy_done` writes to `.deploy-history.jsonl` (line 145); add `,"message":"%s"` with `$_EMIT_MSG`.
- `apps/api/src/routes/history.ts` — `DeployHistoryEntry` and `CiHistoryEntry` interfaces (lines 22–39) need `message?: string` added. The `readJsonl` calls will pick it up automatically since they return typed objects from parsed JSON.
- `apps/dashboard/src/lib/api.ts` — `DeployHistoryEntry` and `CiHistoryEntry` types exported from here; add `message?: string` to both.
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — SHA is rendered as plain text inside each row (around line 60+). The component already receives `repoUrl?: string`. Wrap the SHA in an `<a>` pointing to `${repoUrl}/commit/${d.sha}` (open in new tab, `stopPropagation` so it doesn't trigger the log-view click). Below the SHA/timestamp line, render `d.message` if present in a `text-[11px] text-subtle` span, truncated.
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — apply the same SHA-link + message treatment. Read `project.config.github.repo` to build the URL (`https://github.com/${repo}`).
- The project detail page passes `project` down to both timelines; `project.config.github.repo` gives the repo slug.

## Tasks

1. Read `ci-utils.sh`, `deploy-timeline.tsx`, `ci-timeline.tsx`, and `apps/dashboard/src/lib/api.ts` to confirm exact field names and component signatures.
2. In `ci-utils.sh`: capture `_EMIT_MSG` at `ci_init` and embed in both `ci_step` status writes and `ci_done` history line. Escape quotes.
3. In `ci-utils.sh`: same for `deploy_init` / `deploy_done`.
4. In `history.ts`: add `message?: string` to both history entry interfaces.
5. In `api.ts` (dashboard lib): add `message?: string` to both entry types.
6. In `deploy-timeline.tsx`: render SHA as `<a>` GitHub link + show `d.message` below the row metadata.
7. In `ci-timeline.tsx`: same treatment.
8. Run `pnpm nx typecheck dashboard` and `pnpm nx typecheck api`.

## Files involved

- `scripts/lib/ci-utils.sh` — capture commit message in `ci_init`, `deploy_init`, embed in history writes
- `apps/api/src/routes/history.ts` — add `message?: string` to entry interfaces
- `apps/dashboard/src/lib/api.ts` — add `message?: string` to client-side types
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — SHA link + message display
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — SHA link + message display

## Acceptance criteria

- [x] `ci_done` appends `message` field to `.ci-history.jsonl` entries
- [x] `deploy_done` appends `message` field to `.deploy-history.jsonl` entries
- [x] Deploy timeline SHA links to `github.com/<repo>/commit/<sha>` (opens new tab)
- [x] Deploy timeline shows commit message below each row when present
- [x] CI timeline has the same SHA link + message treatment
- [x] `pnpm nx typecheck dashboard` and `pnpm nx typecheck api` clean

## Out of scope

- Fetching message for historical entries that predate this sprint (those will just have no message — `message?: string` handles gracefully)
- Showing changed files or diff stats
- CI timeline auto-refresh (already handled by sprint 92's pattern if desired later)

## Completed

**Date:** 2026-06-28

### Summary
Added `_EMIT_MSG` capture (`git log -1 --format="%s"`) to both `ci_init` and `deploy_init` in `ci-utils.sh`, with double-quote escaping. Both `ci_done` and `deploy_done` now embed the message field in their JSONL history writes. Added `message?: string` to the `DeployHistoryEntry` and `CiHistoryEntry` interfaces in both the API and dashboard client. The GitHub SHA links were already implemented (sprint 82) — only the commit message rendering was missing; added a truncated `text-subtle` line below the metadata row in both timelines.

### Files changed
- `scripts/lib/ci-utils.sh` — `_EMIT_MSG` init + capture in `ci_init`/`deploy_init`, embedded in history JSONL writes
- `apps/api/src/routes/history.ts` — `message?: string` on both history entry interfaces
- `apps/dashboard/src/lib/api.ts` — `message?: string` on both exported entry types
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — render `d.message` below metadata row
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — render `r.message` below metadata row

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean
- SHA links: already present in both timelines (confirmed in code review)
- Message field: added to JSONL writes; `message?: string` optional so historical entries without it render cleanly

### Follow-ups
- none
