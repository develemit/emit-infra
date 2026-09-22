# Honest unreachable states on the detail, networking and live-log pages
**Difficulty:** 3

## Goal
An unreachable project's detail page shows last-known state, a retry, and
disables actions that need SSH. Networking panels say why they're empty. The
live log page never shows a green "live" badge on a dead connection. Deploy
can't get stuck on "Running…".

## Reason
UI-03 (networking and logs instances), UI-04 (broken), UI-11 (degraded) in
`qa/ui-audit-2026-09-22.md`. Sprint 347 set the pattern for telling errors from
empty. This sprint applies it to the pages you open **during an incident**,
which is exactly when a dead server must not look like a quiet one.

## Context
Builds on sprint 347: reuse its result type (`src/lib/fetch-result.ts`) and
shared panel-state component (`src/components/ui/panel-state.tsx`). Read them
first. If 347 named them differently, follow what it actually shipped.

### UI-04 — Deploy stuck on "Running…" (broken)
`apps/dashboard/app/projects/[name]/page.tsx`: `handleDeployClick` (≈line 57)
calls `setDeploying(true)`. The `<DeployPanel>` that actually sends the request
only mounts in the reachable branch. In the "SSH unreachable" branch nothing
sends and nothing clears `deploying`, so the button reads "Running…" forever.
Disable Deploy (with a visible reason) when status is unreachable, rather than
mounting the panel. Deploying to a server you can't reach can't succeed.

### UI-11 — unreachable detail is a bare banner (degraded)
Same page: the unreachable branch renders only "SSH unreachable — the server did
not respond" and nothing else, while every header action (Deploy, Rollback,
Sync Secrets, Destroy, Ask Claude) stays enabled. Add a Retry (the page already
has `fetchData`), show what's known without SSH (last deploy from history, IP,
domain), and disable the SSH-dependent actions with a tooltip/reason. Leave
Destroy's availability as it is. Decide and state why; it's the one action you
might genuinely want on a dead server. Actions live in
`src/components/detail/project-header.tsx` (desktop) and the mobile bar at
`page.tsx:185`.

### UI-03 — networking panels vanish
On `test-smoke`, `/projects/[name]/networking` shows only Top Endpoints.
`src/components/detail/response-time-panel.tsx`, `cert-panel.tsx` and
`nginx-config-panel.tsx` `return null` on fetch failure, and so does the
bandwidth chart. Render the shared unreachable state instead.

### UI-03 — live logs "● live" on a dead stream
`app/projects/[name]/logs/page.tsx`: `running && <span>● live</span>` (≈line 177);
`es.onerror = () => stop()` (≈line 81). On `test-smoke` the badge stays green
over an empty `$` prompt. Show "connecting…" until the first event arrives,
switch to an error state on `error` events / `onerror`, and only show "live"
once data has flowed. The route is `GET /projects/:name/logs` (SSE) in
`apps/api/src/routes/operations.ts`; it emits `{type:'error'}` events.

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Visual checks only through `tools/ui-audit/read-only-guard.mjs`; `test-smoke`
  is the real unreachable project. Keep live-log pages open for seconds, not
  minutes, since each holds an SSH connection to production.
- `page.tsx` is 236 lines; if this pushes it past 300, extract the unreachable
  branch into `src/components/detail/unreachable-state.tsx`.

## Tasks
1. Disable Deploy (and other SSH-dependent actions) when unreachable, with a reason.
2. Give the unreachable detail page last-known info and a Retry.
3. Replace `return null` in the networking panels with the shared state.
4. Make the live-log badge reflect real stream state.

## Files involved
- `apps/dashboard/app/projects/[name]/page.tsx` — unreachable branch, deploy gating
- `apps/dashboard/src/components/detail/project-header.tsx` — disabled actions + reason
- `apps/dashboard/src/components/detail/response-time-panel.tsx`, `cert-panel.tsx`, `nginx-config-panel.tsx` (+ bandwidth chart)
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — stream state
- possibly new file: `apps/dashboard/src/components/detail/unreachable-state.tsx`

## Acceptance criteria
- [ ] Deploy is disabled with a stated reason when the project is unreachable,
      and can never enter "Running…" without a request — covered by a test
- [ ] Unreachable detail page offers Retry and shows last-known info
- [ ] Networking panels render an unreachable state instead of disappearing —
      covered by a test for at least one panel
- [ ] Live-log badge shows connecting → live only after data, and an error state
      on stream error — covered by a test of the state logic (extract it into a
      small hook/reducer to make it testable)
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Deploy confirmation and panel placement (sprints 349-350).
- API changes to the logs stream.
