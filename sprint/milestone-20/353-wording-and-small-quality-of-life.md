# Wording and small quality-of-life fixes across the dashboard
**Difficulty:** 2

## Goal
Clear up the audit's remaining wording and small usability gaps: a raw exception
in the ops chat, a dangling "last seen —", a blank filtered table, a log list
with no health hint, dead container columns, and view-only cron/firewall panels
that don't say they're view-only.

## Reason
UI-19, UI-21 (wording), UI-23, UI-25, UI-26, UI-31 (polish) in
`qa/ui-audit-2026-09-22.md`. None is serious on its own, but together they're
the difference between a tool that explains itself and one you have to already
understand.

## Context

1. **UI-19 ops chat raw error** — `apps/dashboard/src/lib/use-ops-chat.ts:91-92`:
   `push({ … text: \`Error: ${String(err)}\` })` shows
   `Error: TypeError: Failed to fetch`. Map network failures to "Couldn't reach
   the emit-infra API. Is the dev stack running?" and other errors to a short
   message. Add a **Retry** that resends the last user message. The chat UI is
   `src/components/ops/chat-thread.tsx` / `chat-input.tsx`.
2. **UI-21 "last seen —"** — `src/components/project-card.tsx:142` renders
   `SSH unreachable — last seen —` when there's no timestamp. Say
   `SSH unreachable — never reached` (or omit the clause) when there's no
   last-seen time.
3. **UI-25 /ci empty filter** — `app/ci/page.tsx`: a tab with zero matches shows
   just the header row. Add a "No projects match this filter" row, matching how
   `/health/incidents` handles empty.
4. **UI-26 /logs list health hint** — `app/logs/page.tsx` (73 lines) lists
   project + domain only; unreachable `test-smoke` looks identical to healthy
   projects. Add a small status dot using data the overview already fetches
   (reuse its status helper; don't add new SSH calls per row if a cached status
   exists).
5. **UI-23 containers table** — `src/components/detail/container-table.tsx`,
   `desktop-container-row.tsx`, `container-row-utils.ts`: CPU / MEM / RESTARTS
   show "–" for every container on a healthy long-running project, and IMAGE is
   CSS-truncated with no way to read it. First find out why the numbers are
   missing: check the containers API (`apps/api/src/routes/project-docker.ts`,
   `GET /projects/:name/containers`) for whether it returns those fields. If it
   does and the UI drops them, fix the mapping. If it never collects them,
   **remove the dead columns** rather than building stats collection here (note
   that as a follow-up). Add `title=` with the full image ref on the truncated cell.
6. **UI-31 cron and firewall are view-only** — decision: **keep them
   view-only**. The API has add/delete endpoints, but editing a production
   firewall from a browser button is exactly the kind of action the audit's
   safety work was about, and nothing in the backlog asks for it. Make the
   panels say so: a one-line caption such as "Read-only — managed by Ansible
   (`infra/ansible/…`)". Find where cron/UFW are actually managed and name it
   accurately.

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Browser checks only via `tools/ui-audit/read-only-guard.mjs`. Sending an ops
  chat message goes to an AI operator that can act on servers: in any browser
  check it must stay blocked by the guard.

## Tasks
1. Friendly ops-chat errors + Retry.
2. Fix the "last seen" clause.
3. Empty-filter row on `/ci`.
4. Status dots on `/logs`.
5. Diagnose container stats; fix or remove columns; image tooltip.
6. Read-only captions on cron/UFW panels.

## Files involved
- `apps/dashboard/src/lib/use-ops-chat.ts`, `src/components/ops/*`
- `apps/dashboard/src/components/project-card.tsx`
- `apps/dashboard/app/ci/page.tsx`, `app/logs/page.tsx`
- `apps/dashboard/src/components/detail/container-table.tsx`, `desktop-container-row.tsx`, `mobile-container-row.tsx`, `container-row-utils.ts`
- `apps/dashboard/src/components/detail/cron-panel.tsx`, `ufw-panel.tsx`

## Acceptance criteria
- [x] A failed ops-chat send shows a friendly message and a working Retry —
      covered in `use-ops-chat.test.ts`
- [x] Unreachable card never renders "last seen —" — covered by a test
- [x] `/ci` empty filter shows a message row — covered by a test
- [x] `/logs` rows show reachability — covered by a test
- [x] Container columns either show real values or are removed, with the cause
      named in the Completed section; image cell has a full-value tooltip —
      covered in `container-row.test.tsx`
- [x] Cron/UFW panels state they're read-only and where they're managed
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Adding cron/UFW editing (decided against above).
- Collecting container CPU/memory stats server-side.

## Completed

**Date:** 2026-09-22

### Summary
Fixed all six wording/quality-of-life items from the audit. The ops chat now
maps network failures and generic errors to friendly text and offers a
**Retry** that resends the failed message without duplicating the user
bubble (`use-ops-chat.ts` gained an internal `sendMessage` used by both
`submit` and the new `handleRetry`; a `type: 'error'` chat message variant
carries the retry text). The unreachable project card now says "never
reached" instead of "last seen —" when there's no last-seen timestamp. `/ci`
and `/logs` both got empty/status affordances matching existing patterns
elsewhere in the app (`/health/incidents`'s empty state, and the overview's
per-project `getStatus` + `deriveHealth` pairing).

The container-stats investigation (UI-23) found the real cause: the
containers API (`GET /projects/:name/containers`) returns each container's
**full** docker name (`myapp-api-1`), but `collect-metrics.sh` keys its
per-container CPU/mem/restarts by a **short** name — it strips the replica
suffix and takes the last `-`-delimited segment (`api`). `container-table.tsx`
was looking up metrics and the restart-sparkline series by the full name, so
the lookup always missed and every container showed "–". Metrics collection
was never the problem; the mapping was. Added `shortContainerName()` in
`container-row-utils.ts` mirroring the shell script's exact stripping rule
and used it at both lookup sites. Also added a `title=` tooltip with the full
image ref on both the desktop and mobile container rows (the sprint only
named the desktop truncation, but the mobile row truncates identically).

Cron/UFW panels now show a small read-only caption naming where they're
actually managed, traced from the ansible roles: UFW rules come from
`ansible/roles/common/tasks/main.yml`; cron jobs come from the `cron` module
in `ansible/roles/postgres-backup` and `ansible/roles/nginx`.

### Files changed
- `apps/dashboard/src/lib/use-ops-chat.ts` — friendly error messages via
  `friendlyErrorMessage`; refactored `submit` around a shared `sendMessage`;
  added `handleRetry`
- `apps/dashboard/src/lib/ops-chat-context.ts` — added `friendlyErrorMessage`
- `apps/dashboard/src/components/ops/types.ts` — added `error` chat message
  variant with `retryText`
- `apps/dashboard/src/components/ops/message.tsx` — added `ErrorMessage`
  with a Retry button
- `apps/dashboard/src/components/ops/chat-thread.tsx` — renders `error`
  messages; takes an `onRetry` prop
- `apps/dashboard/app/ops/page.tsx` — wires `handleRetry` into `ChatThread`
- `apps/dashboard/src/components/project-card.tsx` — "never reached" instead
  of "last seen —" when there's no timestamp
- (new) `apps/dashboard/src/components/project-card.test.tsx`
- `apps/dashboard/app/ci/page.tsx` — empty-filter message row (desktop table
  + mobile cards)
- (new) `apps/dashboard/app/ci/page.test.tsx`
- `apps/dashboard/app/logs/page.tsx` — per-project reachability dot, reusing
  `getStatus` + `deriveHealth`
- (new) `apps/dashboard/app/logs/page.test.tsx`
- `apps/dashboard/src/components/detail/container-row-utils.ts` — added
  `shortContainerName()`
- `apps/dashboard/src/components/detail/container-table.tsx` — uses
  `shortContainerName()` for both the metrics map and restart-series lookups
- `apps/dashboard/src/components/detail/desktop-container-row.tsx` — `title=`
  tooltip on the image cell
- `apps/dashboard/src/components/detail/mobile-container-row.tsx` — `title=`
  tooltip on the image cell
- `apps/dashboard/src/components/detail/container-row.test.tsx` — tests for
  `shortContainerName` and the image tooltip
- `apps/dashboard/src/components/detail/cron-panel.tsx` — read-only caption
- `apps/dashboard/src/components/detail/ufw-panel.tsx` — read-only caption
- `apps/dashboard/src/components/detail/cron-panel.test.tsx` — caption test
- `apps/dashboard/src/components/detail/ufw-panel.test.tsx` — caption test

### Verification
- `pnpm test` (root, nx run-many): 351/351 pass
- `pnpm typecheck` (root, nx run-many): clean across all 5 projects
- `pnpm lint` (root, nx run-many): clean across all 5 projects

### Follow-ups
- `[defer]` The container-stats fix assumes container names use `-` as the
  compose separator (matching `collect-metrics.sh`'s own assumption). If any
  project's compose file uses underscore-separated names, both the collector
  and this mapping fix would need updating together.
