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
- [ ] Deploy requires one confirm and shows project + current build; the
      disk/memory warning appears inside that confirm — covered by a test
- [ ] One confirmed Deploy sends exactly one POST, including under StrictMode
      double-mount — covered by a test that counts fetch calls
- [ ] Prune requires a confirm naming what will be removed — covered by a test
- [ ] Destroy and the new confirm dialog render above the mobile tab bar
      (z-index + bottom padding), verified with a guarded 390×844 screenshot
      whose buttons are tappable (`elementFromPoint` hits the button)
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Moving Rollback / Sync Secrets panels (sprint 350).
- Changing the API's 409 behaviour.
