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
- [x] Deploy is disabled with a stated reason when the project is unreachable,
      and can never enter "Running…" without a request — covered by a test
- [x] Unreachable detail page offers Retry and shows last-known info
- [x] Networking panels render an unreachable state instead of disappearing —
      covered by a test for at least one panel
- [x] Live-log badge shows connecting → live only after data, and an error state
      on stream error — covered by a test of the state logic (extract it into a
      small hook/reducer to make it testable)
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Deploy confirmation and panel placement (sprints 349-350).
- API changes to the logs stream.

## Completed

**Date:** 2026-09-22

### Summary
Extended sprint 347's `FetchResult`/`PanelState` pattern to the pages you open
during an incident.

`getCertDetails`, `getResponseTimes` and `getNginxDrift` (`api-infra.ts`) now
return `FetchResult<T>` instead of silently coercing SSH/HTTP failures into
`null`. `ResponseTimePanel` and `CertPanel` (previously bare `return null` on
any fetch failure) now render a titled card with `<PanelState kind={...} />`
on `unreachable`/`error`, while still rendering nothing for the genuinely-empty
success case (`{available: false}`, no samples yet) — that distinction mattered
enough to keep. `NginxConfigPanel` was refactored to the same `errorKind`
pattern as 347's `CronPanel`/`UfwPanel` (hides its status badge on error,
`PanelState` in the body) and its manual `null`-means-unreachable handling
removed. The Networking page's bandwidth chart (`NetworkChart`, gated on
`networkPoints.length >= 2`) fetches project status once and shows a
`PanelState kind="unreachable"` instead of silently vanishing when there's no
metrics data *and* the server can't be reached; it still renders nothing when
there's just no data yet on a reachable project.

For the detail page (UI-04/UI-11), added `apps/dashboard/src/components/detail/unreachable-state.tsx`:
the SSH-unreachable branch now shows a Retry button (wired to the page's
existing `fetchData`) plus a "Last known" card built entirely from data that
doesn't require a live SSH connection — `project.config.domain`/`serverIp`
(from `getProjects()`, local config) and the most recent entry from
`useDeployMarkers()`'s deploy history (local `.deploy-history.jsonl`, also
SSH-independent). `ProjectHeader` gained an `unreachable` prop that disables
Deploy, Rollback and Sync Secrets (all genuinely need to reach the server) with
a `title` tooltip explaining why; Destroy stays enabled per the sprint's
explicit call — it's the one action you might actually want on a dead server.
`handleDeployClick` also early-returns when unreachable as defense in depth,
and the mobile bottom action bar got the same three buttons disabled. This
closes the actual bug (UI-04): previously the unreachable branch simply never
mounted `<DeployPanel>`, so a stray click set `deploying=true` with nothing to
ever clear it, and the button read "Running…" forever.

For the live-logs page (UI-03), extracted the stream state machine into a pure
reducer, `apps/dashboard/src/lib/log-stream-status.ts` (`'connecting' | 'live' |
'error'`), driven by `start`/`line`/`done`/`stream-error` events. The page's
`SseParsed` type gained the `exitCode` field the backend was already sending on
`done` but the frontend was silently discarding; a `done` with a nonzero
exit code (e.g. `ssh` hitting `ConnectTimeout=10` and exiting 255) now resolves
to `'error'`, not "the stream just ended." The mobile-header and desktop-topbar
badges, previously a single `running && '● live'` span, now render the
reducer's status persistently — the first attempt was gated on `running` too,
which hid the final `'error'` state the instant `stop()` cleared `running`
after a failed connection (caught by the manual Playwright check below, not by
the unit tests, since the reducer itself was correct — the bug was in when the
page chose to render it). `Terminal`'s `running` prop (which drives its own
"● live" bar badge and the blinking `$` prompt) now reads `status === 'live'`
instead of the old "an EventSource is open" boolean, so a dead connection that
briefly emits an ssh stderr line no longer parks a green cursor over nothing.

### Files changed
- `apps/dashboard/src/lib/api-infra.ts` — `getCertDetails`/`getResponseTimes`/`getNginxDrift` return `FetchResult`
- `apps/dashboard/src/components/detail/response-time-panel.tsx` — renders unreachable/error distinctly from empty
- (new) `apps/dashboard/src/components/detail/response-time-panel.test.tsx`
- `apps/dashboard/src/components/detail/cert-panel.tsx` — renders unreachable/error distinctly
- (new) `apps/dashboard/src/components/detail/cert-panel.test.tsx`
- `apps/dashboard/src/components/detail/nginx-config-panel.tsx` — `errorKind` pattern, hides badge on error
- `apps/dashboard/src/components/detail/nginx-config-panel.test.tsx` — updated mocks to `FetchResult` shape
- `apps/dashboard/app/projects/[name]/networking/page.tsx` — bandwidth chart shows unreachable state instead of vanishing
- (new) `apps/dashboard/src/components/detail/unreachable-state.tsx` — Retry + last-known info
- (new) `apps/dashboard/src/components/detail/unreachable-state.test.tsx`
- `apps/dashboard/src/components/detail/project-header.tsx` — `unreachable` prop disables Deploy/Rollback/Sync Secrets
- (new) `apps/dashboard/src/components/detail/project-header.test.tsx`
- `apps/dashboard/app/projects/[name]/page.tsx` — deploy gating, wires `UnreachableState`
- (new) `apps/dashboard/src/lib/log-stream-status.ts` — pure `connecting|live|error` reducer
- (new) `apps/dashboard/src/lib/log-stream-status.test.ts`
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — reducer-driven status badge, `exitCode`-aware `done` handling

### Verification
- `pnpm test`: 285/285 pass (dashboard; other 4 projects unaffected, nx cache)
- `pnpm typecheck`: 5 projects, clean
- `pnpm lint`: 5 projects, clean
- Manual: guarded Playwright pass against `test-smoke` (real unreachable
  project, no write requests) confirmed the detail page's Retry/last-known
  card and disabled buttons, all three networking panels showing "Couldn't
  reach the server", and the logs page transitioning connecting → `stream
  error` (never settling on live) after the real `ssh: ... Operation timed
  out` failure. This caught the `running &&`-gated badge bug the unit tests
  alone missed. Script was a scratch file, not committed.

### Follow-ups
- `[defer]` `NginxEndpointsPanel` ("Top Endpoints") still collapses unreachable
  and genuinely-empty into one "nginx access log not available" message. Not
  touched here since it wasn't in this sprint's file list and doesn't silently
  vanish (it was never a `return null` offender), but it'd be a natural next
  panel to bring onto the `FetchResult`/`PanelState` pattern.
- `[defer]` The main detail page's resource chart, disk/memory trend, SLA and
  container-restart data (`use-server-metrics`, `use-disk-trend`, etc.) still
  silently render nothing on fetch failure rather than distinguishing
  unreachable from empty. Out of scope here (not SSH-dependent in the same
  way — they read a local metrics history that can be legitimately sparse),
  but worth a pass if UI audits flag it again.
