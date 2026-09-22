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
- [x] Clicking Rollback / Sync Secrets / confirming Deploy shows its panel in the
      viewport without scrolling — covered by a component test that the sheet
      opens, plus a guarded desktop + mobile screenshot
- [x] Only one action sheet is open at a time — covered by a test
- [x] Closing a sheet with a running stream follows the stated behaviour — covered by a test
- [x] Mobile offers every desktop header action — covered by a test or screenshot
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Changing what Rollback / Sync Secrets do.
- Destroy (keeps its dedicated modal from 349).

## Completed

**Date:** 2026-09-22

### Summary
Built `ActionSheet` (`apps/dashboard/src/components/detail/action-sheet.tsx`) —
a shared overlay following the same conventions as sprint 349's `ConfirmDialog`
(`role="dialog"`, `z-[60]`, backdrop, safe-area clearance): a right-side drawer
on desktop (`lg:w-[440px]`, fixed to the right edge) and a bottom sheet on
mobile (`top-[25%]`, full width), both `fixed`-positioned so they render in the
viewport regardless of where they mount in the DOM. `DeployPanel`,
`RollbackPanel` and `SecretsSyncPanel` all now render their running/streaming
state through `ActionSheet` instead of duplicating desktop-inline +
mobile-bottom-sheet markup — this deleted ~120 duplicated lines across the
three panels and fixed UI-10 (panels no longer mount at the bottom of the page).

**Close-while-running decision:** kept the pre-existing behaviour (hide the
close control while the stream is running) rather than building a new warn
dialog or minimize-to-badge mechanism. This was a deliberate choice after
checking the backend: none of `apps/api/src/routes/deploy.ts`, `rollback.ts`
or `secrets-sync.ts` wire client-disconnect to process cancellation (unlike
`operations.ts`/`container-logs.ts`, which do via `req.raw.on('close')` →
`AbortController`). All three commands run to completion server-side
regardless of whether the browser is still listening, so closing the sheet was
never actually capable of aborting the operation — the only real risk was the
user losing visibility into the result. Disabling the close control (already
the established pattern from `DestroyModal` and the mobile-only halves of the
old panels) fully addresses that risk with zero new UI, so `ActionSheet` just
centralizes it: `closeDisabled` hides the header's X button and disables
backdrop-click-to-close.

**Only one sheet at a time:** rather than force-closing whichever sheet is
already open (which would have silently dropped visibility into a real
in-flight operation), `page.tsx` now computes `sheetOpen = deploying ||
showRollback || showSecretsSync` and disables the Deploy / Rollback / Sync
Secrets triggers in both `ProjectHeader` and the new `MobileActionBar`
whenever any sheet is open. A second click target for a different action is
simply unavailable until the current sheet is closed (which itself is only
possible once its stream finishes, for the running case).

**Mobile action bar (UI-17):** extracted from `page.tsx` into
`mobile-action-bar.tsx` and added a fifth item, "Claude" (linking to
`/ops?project=…`, mirroring the desktop header's "Ask Claude"), to the
Logs/Secrets/Rollback/Destroy row. Used the shortened label to keep 5 items
fitting the 390px width without an overflow menu — verified with a 390×844
guarded screenshot that nothing wraps or overflows.

Extracting `MobileActionBar` also shrank `page.tsx` from 221 to 188 lines and
means the "add Ask Claude" edit lives in one place rather than being
duplicated between the header and a page-local bar.

### Files changed
- (new) `apps/dashboard/src/components/detail/action-sheet.tsx` — shared
  desktop-drawer/mobile-bottom-sheet chrome (header, icon, title, optional
  close), following `ConfirmDialog`'s z-index/overlay conventions
- (new) `apps/dashboard/src/components/detail/mobile-action-bar.tsx` —
  extracted mobile action row from `page.tsx`; added "Claude" (Ask Claude)
- `apps/dashboard/src/components/deploy-panel.tsx` — running step now renders
  via `ActionSheet` instead of duplicated desktop/mobile blocks
- `apps/dashboard/src/components/rollback-panel.tsx` — same; dropped the
  now-redundant inline "Close" button (header X covers it)
- `apps/dashboard/src/components/secrets-sync-panel.tsx` — same
- `apps/dashboard/src/components/detail/project-header.tsx` — added
  `sheetOpen` prop; Deploy/Rollback/Sync Secrets triggers disable while any
  action sheet is open (Destroy untouched, per out-of-scope)
- `apps/dashboard/app/projects/[name]/page.tsx` — computes `sheetOpen`, wires
  it through, renders `MobileActionBar` instead of an inline bottom bar;
  moved the three sheet-triggering panels next to the header (cosmetic now
  that they're `fixed`-positioned overlays)
- (new) `apps/dashboard/src/components/detail/action-sheet.test.tsx`,
  `mobile-action-bar.test.tsx`, `rollback-panel.test.tsx`,
  `secrets-sync-panel.test.tsx` — sheet opens with dialog role, close hidden
  while `closeDisabled`, backdrop click closes/doesn't, Ask Claude present,
  triggers disabled while a sheet is open
- `apps/dashboard/src/components/deploy-panel.test.tsx`,
  `apps/dashboard/src/components/detail/project-header.test.tsx` — added
  running-step-opens-in-sheet and `sheetOpen`-disables-triggers coverage

### Verification
- `pnpm test` (full, root `nx run-many -t test`): 314/314 pass across 44 test
  files
- `pnpm typecheck` (full, root): clean across all 5 projects
- `pnpm lint` (full, root): clean across all 5 projects
- Guarded browser check (ephemeral script, Playwright + `read-only-guard.mjs`,
  run from `/tmp`, against the live `pnpm launch` dev dashboard, project
  `test-smoke` with a stubbed healthy status): at 1440×900, Rollback and Sync
  Secrets sheets open on the right in the viewport (`elementFromPoint`
  confirms no scroll needed), Deploy/Sync Secrets triggers are disabled while
  Rollback is open, and Sync Secrets' close control is absent while its
  (guard-blocked) POST never resolves; at 390×844, Rollback opens as a bottom
  sheet clearing/covering the fixed tab bar and "Claude" is visible in the
  mobile action bar. Zero non-GET requests reached the API — the two write
  attempts (Sync Secrets' POST, fired twice by React) were both intercepted
  by the guard. Screenshots and the script were ephemeral, not committed.

### Follow-ups
- `[defer]` `RollbackPanel`'s "no snapshots" and cancel-before-restore states
  still render their own inline Cancel/Restore buttons inside the sheet body
  alongside the header's close X — slightly redundant affordances, harmless,
  not worth a new prop for.
- `[defer]` `ActionSheet` and `ConfirmDialog` both hand-roll the same
  z-index/backdrop/safe-area conventions rather than sharing a base
  overlay primitive. Two data points isn't enough to force an abstraction
  yet; if a third overlay shape shows up, extract the common parts then.
- `[defer]` The mobile action bar's 5-item row ("Logs Claude Secrets Rollback
  Destroy") is visually tight at 390px (verified it doesn't wrap, but there's
  little margin left). If a 6th action is ever needed, an overflow menu
  becomes the better option than a 6th shortened label.
