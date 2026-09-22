# Open Rollback, Sync Secrets and Deploy output where you clicked
**Difficulty:** 3

## Goal
Clicking a header action shows its panel immediately, in view, instead of
mounting it below the charts at the bottom of the page. The mobile action bar
offers the same actions as the desktop header.

## Reason
UI-10 and UI-17 (degraded) in `qa/ui-audit-2026-09-22.md`. On the project
detail page, Rollback, Sync Secrets and the deploy output panel all mount at the
very end of the page. Clicking the header button looks like it did nothing, and
you have to scroll to discover the panel. That is the worst possible behaviour
for a rollback during an incident. Mobile also silently drops "Ask Claude".

## Context
Builds on sprint 349, which introduced a shared confirm dialog
(likely `src/components/ui/confirm-dialog.tsx`) and folded the "Deploy anyway"
banner into it. Read what 349 actually shipped first.

### Where panels mount today
`apps/dashboard/app/projects/[name]/page.tsx`, reachable branch: after the
health card, alert banners, charts and sub-page cards come
`{deploying && <DeployPanel … />}`, `{showRollback && <RollbackPanel … />}` and
`{showSecretsSync && <SecretsSyncPanel … />}`
(`src/components/rollback-panel.tsx`, `src/components/secrets-sync-panel.tsx`).
Page scroll happens inside `main.overflow-auto`, not `document.body`, so
`scrollIntoView` works but `window.scrollTo` doesn't.

### Decision to implement
Render these three as a **right-side sheet/drawer on desktop and a bottom
sheet on mobile**, built on the same overlay component as 349's confirm dialog.
They stream long output (Ansible, rollback), which suits a sheet better than a
small centred modal, and the page behind stays visible for context. Only one
action sheet at a time. Closing it must not abort a running operation silently:
if the stream is still running, closing should warn or keep it running in a
minimised state. Pick one and state which.

The simpler alternative (render the panels directly under the header and
`scrollIntoView`) is acceptable if the sheet proves awkward. Say which you chose
and why in the Completed section.

### Mobile action bar (UI-17)
`page.tsx:185` renders the `lg:hidden` bottom bar (Deploy + a row of secondary
actions); the desktop header (`src/components/detail/project-header.tsx`) has
Logs, Ask Claude, Sync Secrets, Rollback, Deploy, Destroy. Ask Claude is missing
on mobile. Add it, or an overflow ("More") menu if the row gets cramped at 390px.
The bar sits at `bottom-16` above the tab bar (`src/components/shell/tab-bar.tsx`),
and sheets must clear both.

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Browser checks only via `tools/ui-audit/read-only-guard.mjs`, and click
  actions only on `test-smoke` with a stubbed healthy status (see
  `tools/ui-audit/prove-guard.mjs` for the stub). Rollback and Sync Secrets are
  real production operations.
- `page.tsx` should end up smaller, not larger; move the sheet wiring into a
  component such as `src/components/detail/action-sheet.tsx`.

## Tasks
1. Build an action sheet on the shared overlay (desktop right, mobile bottom).
2. Move Deploy output, Rollback and Sync Secrets into it.
3. Decide and implement close-while-running behaviour.
4. Add Ask Claude (or a More menu) to the mobile action bar.

## Files involved
- `apps/dashboard/app/projects/[name]/page.tsx` — remove bottom-of-page panels
- new file: `apps/dashboard/src/components/detail/action-sheet.tsx`
- `apps/dashboard/src/components/rollback-panel.tsx`, `secrets-sync-panel.tsx`, `deploy-panel.tsx` — render inside the sheet
- `apps/dashboard/src/components/detail/project-header.tsx` / mobile bar — Ask Claude

## Acceptance criteria
- [ ] Clicking Rollback / Sync Secrets / confirming Deploy shows its panel in the
      viewport without scrolling — covered by a component test that the sheet
      opens, plus a guarded desktop + mobile screenshot
- [ ] Only one action sheet is open at a time — covered by a test
- [ ] Closing a sheet with a running stream follows the stated behaviour — covered by a test
- [ ] Mobile offers every desktop header action — covered by a test or screenshot
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Changing what Rollback / Sync Secrets do.
- Destroy (keeps its dedicated modal from 349).
