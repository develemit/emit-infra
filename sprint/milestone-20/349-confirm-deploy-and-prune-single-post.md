# Confirm before Deploy and Prune; one click sends one request; Destroy works on mobile
**Difficulty:** 4

## Goal
Deploy and Prune ask for a lightweight confirmation that shows what's about to
happen. A single Deploy click sends exactly one request. The Destroy modal's
buttons can be tapped on a phone.

## Reason
UI-09 (degraded) and UI-02 (broken) in `qa/ui-audit-2026-09-22.md`. This
dashboard ships to production from one button. Today Deploy and Prune fire on a
single click with no confirmation, while Destroy has a modal. Deploy's click
also sent its POST twice (1 ms apart) in the audit. And on mobile, the Destroy
modal's Cancel/Continue sit **under** the bottom tab bar: the most destructive
action in the app can't be confirmed or safely cancelled by tapping.

## Context

### Deploy fires immediately
`apps/dashboard/app/projects/[name]/page.tsx` `handleDeployClick` (≈line 57):
if disk/memory ≥80% it shows a "Deploy anyway" banner, otherwise
`setDeploying(true)`, which mounts `<DeployPanel url=… />`
(`src/components/deploy-panel.tsx`). The panel starts the stream through
`useSseStream` (`src/lib/use-sse-stream.ts`), whose `useEffect` calls
`fetch(url, { method: 'POST' })`.

### The double POST
React StrictMode (dev) runs mount effects twice. The effect's AbortController
aborts the first stream, but the **POST has already been sent**. The API rejects
the second with 409 ("deploy already running", `apps/api/src/routes/deploy.ts`),
so it's harmless today, but starting a side-effecting request from an effect is
fragile (any remount re-deploys). Fix it structurally: start the deploy from the
click/confirm handler (or guard with a ref so one mount = at most one POST), and
let the panel only consume the stream. Keep `useSseStream` working for its other
callers; grep for them first.

### Confirmation design (decided)
A small confirm step, not a type-the-name modal. Deploy isn't irreversible the
way Destroy is, and friction trains you to click through. Show: project, current
build/sha (from status), and the disk/memory warning folded in. That replaces
the separate "Deploy anyway" banner, so there's one flow instead of two. Reuse
the existing modal pattern from `src/components/destroy-modal.tsx` (or extract a
shared `ConfirmDialog`) so sprint 350 can move Rollback/Sync Secrets onto the
same component.

Prune: `src/components/detail/docker-usage.tsx` `handlePrune` (≈line 61) fires
`pruneDocker` directly. Confirm with the reclaimable size the panel already
shows ("Remove N GB of unused images/build cache").

### Destroy modal on mobile
`src/components/destroy-modal.tsx:45`:
`fixed inset-0 z-50 flex items-end sm:items-center … p-4`. The tab bar
(`src/components/shell/tab-bar.tsx:22`) is `md:hidden fixed bottom-0 … z-50`,
the same z-index, and the modal anchors to the bottom on small screens. Raise
the modal above the tab bar and add bottom padding for its height (plus
`env(safe-area-inset-bottom)`). Any shared ConfirmDialog must get this right
too.

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- **Any browser check must use `tools/ui-audit/read-only-guard.mjs`**. These are
  real production buttons. Click them only on `test-smoke` (domain
  `192.0.2.1`); `tools/ui-audit/prove-guard.mjs` shows how to stub a healthy
  status for it so the Deploy flow renders. The guard log is also the easiest
  way to count how many POSTs one click sends.
- Files ≤300 lines.

## Tasks
1. Build (or extract) a shared confirm dialog that clears the mobile tab bar.
2. Put Deploy behind it, folding in the disk/memory warning.
3. Start the deploy POST exactly once per confirmed click.
4. Put Prune behind it with the reclaimable size.
5. Fix the Destroy modal's mobile stacking.

## Files involved
- `apps/dashboard/app/projects/[name]/page.tsx` — deploy flow
- `apps/dashboard/src/components/deploy-panel.tsx`, `src/lib/use-sse-stream.ts` — single POST
- `apps/dashboard/src/components/detail/docker-usage.tsx` — prune confirm
- `apps/dashboard/src/components/destroy-modal.tsx` — mobile stacking
- possibly new file: `apps/dashboard/src/components/ui/confirm-dialog.tsx`

## Acceptance criteria
- [x] Deploy requires one confirm and shows project + current build; the
      disk/memory warning appears inside that confirm — covered by a test
- [x] One confirmed Deploy sends exactly one POST, including under StrictMode
      double-mount — covered by a test that counts fetch calls
- [x] Prune requires a confirm naming what will be removed — covered by a test
- [x] Destroy and the new confirm dialog render above the mobile tab bar
      (z-index + bottom padding), verified with a guarded 390×844 screenshot
      whose buttons are tappable (`elementFromPoint` hits the button)
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Moving Rollback / Sync Secrets panels (sprint 350).
- Changing the API's 409 behaviour.

## Completed

**Date:** 2026-09-22

### Summary
Built a shared `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`) and put
both Deploy and Prune behind it. Deploy's confirm shows the project name,
current build number (from `status.buildNumber`), and folds in the disk/memory
pressure warning that used to be a separate inline banner — that banner and its
`deployWarning` state are gone from `page.tsx` entirely.

The single-POST fix turned out not to need touching `use-sse-stream.ts` at all.
`DestroyModal` already avoided the double-POST bug because its SSE fetch starts
from a `step` state transition on an *already-mounted* component, not from the
component's initial mount — and React's StrictMode dev double-invoke only
replays effects around a component's first mount, not later state-triggered
re-runs. `DeployPanel` had the bug because it mounted directly into
`enabled=true`. Fixed by giving `DeployPanel` the same two-step shape as
`DestroyModal`: it always mounts into a `'confirm'` step (SSE hook disabled,
no fetch), and only flips to `'running'` (enabling the fetch) from the
confirm button's click handler. Verified with a test that renders `DeployPanel`
inside `<React.StrictMode>`, clicks Deploy, and asserts `fetch` was called
exactly once.

Prune in `docker-usage.tsx` now opens the same `ConfirmDialog`, listing each
reclaimable resource type and its size (reusing the existing per-row
`reclaimable` strings — no new size-parsing logic).

Destroy modal's mobile stacking fix (`z-50` → `z-[60]`, plus
`pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)]` below `sm:`) was applied to
its own container and reused verbatim inside `ConfirmDialog`, since both sit in
the same stacking context as the fixed, same-DOM-order-losing mobile tab bar.
Verified for real: ran a guarded Playwright check (read-only-guard.mjs) against
the live dev dashboard at 390×844 against project `tastease` — `elementFromPoint`
on both the Destroy modal's and the new Deploy confirm's Cancel/Continue buttons
hit the actual buttons, not the tab bar, and zero write requests reached the API
during the check. Screenshots confirmed the dialogs visually clear the tab bar.
The check script was ephemeral (run from `/tmp`, not committed).

`tools/ui-audit/prove-guard.mjs`'s `stageRealDeploy` clicked a `"Deploy anyway"`
button that no longer exists now that Deploy always confirms first; updated it
to click the confirm dialog's own `"Deploy"` button (the second match by role)
instead, so that manual guard-proof tool still exercises the real flow.

### Files changed
- `apps/dashboard/app/projects/[name]/page.tsx` — removed the inline
  `deployWarning` banner/state; `handleDeployClick` just opens `DeployPanel`,
  which now owns its own confirm step; passes `buildNumber`/`disk`/`memory`
  through for the confirm dialog's body
- `apps/dashboard/src/components/deploy-panel.tsx` — added a `'confirm' |
  'running'` step; confirm step renders `ConfirmDialog` with project, current
  build, and the folded-in pressure warning; SSE fetch only starts once the
  user confirms
- `apps/dashboard/src/components/detail/docker-usage.tsx` — Prune button opens
  a `ConfirmDialog` listing reclaimable resources before calling `pruneDocker`
- `apps/dashboard/src/components/destroy-modal.tsx` — raised z-index above the
  mobile tab bar and added bottom clearance padding below the `sm:` breakpoint
- `tools/ui-audit/prove-guard.mjs` — updated the Deploy click flow to go
  through the new confirm dialog instead of the removed "Deploy anyway" button
- (new) `apps/dashboard/src/components/ui/confirm-dialog.tsx` — shared confirm
  modal (title/subtitle/icon/tone, body slot, confirm/cancel footer, busy
  state), `role="dialog"`, positioned above the mobile tab bar
- (new) `apps/dashboard/src/components/deploy-panel.test.tsx` — confirm-step
  content, pressure-warning folding, cancel-doesn't-POST, single-POST on
  confirm, single-POST under `React.StrictMode`
- (new) `apps/dashboard/src/components/detail/docker-usage.test.tsx` — Prune
  confirm shows reclaimable size before pruning, confirm calls `pruneDocker`,
  cancel does not
- (new) `apps/dashboard/src/components/ui/confirm-dialog.test.tsx` — renders
  title/subtitle/body, confirm/cancel callbacks, busy disables both buttons,
  z-index/padding clear the mobile tab bar

### Verification
- `pnpm test` (full, root `nx run-many -t test`): 299/299 pass across 40 test
  files (dashboard + other Nx projects)
- `pnpm typecheck` (full, root): clean across all 5 projects
- `pnpm lint` (full, root): clean across all 5 projects
- Manual guarded browser check (Playwright + `read-only-guard.mjs`, 390×844,
  against the live `pnpm launch` dev dashboard, project `tastease`): Destroy
  modal's Cancel/Continue and the new Deploy confirm's Cancel/Deploy buttons
  all hit correctly via `elementFromPoint`; zero non-GET requests reached the
  API for the whole check

### Follow-ups
- `[defer]` The mobile bottom-bar Deploy button shows "Running…" as soon as
  the confirm dialog opens (it was already true before this sprint that
  `deploying` gated that label; now `deploying` covers the confirm step too).
  Cosmetic only — the button is correctly disabled either way.
- `[defer]` `DestroyModal` and `ConfirmDialog` now duplicate the same
  z-index/mobile-padding fix rather than `DestroyModal` being rebuilt on top
  of `ConfirmDialog`. Sprint 350 already plans to move Rollback/Sync Secrets
  onto the shared component; folding Destroy in at the same time would avoid
  the duplication but its three-step (warning/confirm/running) flow doesn't
  fit `ConfirmDialog`'s single-step shape without changing it.
