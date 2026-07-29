# Component slimming: split use-ops-chat, container-row variants, settings-section hook
**Difficulty:** 3

## Goal
The three files the audit flagged for doing too much are decomposed: `use-ops-chat.ts` splits session/context concerns into their own modules, `container-row.tsx`'s mobile/desktop variants become sibling files with shared restart logic, and `project-settings-panel.tsx`'s repeated save-flow state moves into a hook. Zero visual or behavior change.

## Reason
2026-07-11 audit (frontend architecture, graded B): `use-ops-chat.ts` (225 lines) mixes session init, context building, submit, and cancel; `container-row.tsx` (251 lines) duplicates ~60% of restart/logs UI between its Mobile and Desktop variants; `project-settings-panel.tsx` (220 lines) runs 14 `useState`s and 4 near-identical inline save helpers. All three follow the house rule "React stateful logic → custom hooks / repeated JSX → subcomponents."

## Context
- **Run after sprints 220/221** — 220's SSE hook and 221's `date-helpers` change some of these files' imports (`use-ops-chat.ts:28` `formatTime` moves to `lib/date-helpers.ts` in 221). Rebase your reading on the current state.
- `apps/dashboard/src/lib/use-ops-chat.ts` (225 lines):
  - `genId` (9), `getConfirmText` (13), `formatTime` (28, removed by sprint 221), `buildContextString` (39) — pure helpers living inside a hook file
  - Split: pure helpers → `lib/ops-chat-context.ts` (or fold `getConfirmText` into `components/ops/` where its copy text belongs); session init → `useOpsSession`; the main hook keeps submit/cancel and composes
  - Existing `use-ops-chat.test.ts` must keep passing — update imports only, don't weaken assertions
- `apps/dashboard/src/components/detail/container-row.tsx` (251 lines):
  - `MobileContainerRow` (~85-140) and `DesktopContainerRow` (~143-249) duplicate the two-step restart-confirm and logs-toggle logic
  - Extract the shared state machine to a small hook (e.g. `useRestartConfirm`) and/or shared subcomponents; variants become sibling files `mobile-container-row.tsx` / `desktop-container-row.tsx` if that reads cleaner
  - `container-row.test.tsx` exists (sprint 210 updated it for the two-step confirm UX) — must keep passing
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` (220 lines):
  - 14 `useState` (~65-82), 4 inline `useSave`-style helpers (~88-122), inline sections (~137-217)
  - Extract a `useSettingsSection` hook capturing the repeated value/saving/saved/error state + save action; sections that repeat JSX become a small subcomponent
  - No test exists — add a basic one for the extracted hook (save success sets saved, failure sets error)
- House rules: target ~200 lines/file, boring names, each extraction independently testable.

## Tasks
1. Read all three files in their post-220/221 state; map what moves where.
2. Split `use-ops-chat.ts`: pure helpers out, `useOpsSession` extracted, main hook composes. Update its test's imports.
3. Decompose `container-row.tsx`: shared restart/logs logic extracted; variants slim.
4. Extract `useSettingsSection` from the settings panel; add a hook test.
5. Verify each touched file ≤ ~200 lines and no new file exceeds 300.
6. Run `pnpm nx test dashboard`, `pnpm nx typecheck dashboard`, `pnpm nx lint dashboard`.

## Files involved
- `apps/dashboard/src/lib/use-ops-chat.ts` — slims to composition
- new file: `apps/dashboard/src/lib/use-ops-session.ts` (+ pure-helper module, name per content)
- `apps/dashboard/src/components/detail/container-row.tsx` — slims or becomes two sibling files + shared hook
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — slims
- new file: `apps/dashboard/src/lib/use-settings-section.ts` (location per hook conventions) + test
- `use-ops-chat.test.ts`, `container-row.test.tsx` — import updates only

## Acceptance criteria
- [x] All three flagged files ≤ ~200 lines; extractions independently testable
- [x] Existing tests pass without weakened assertions; new hook test for settings save flow
- [x] Zero visual/behavior change
- [x] Tests pass, typecheck clean, lint clean

## Out of scope
- The SSE loop removal (sprint 220) and date-helper moves (sprint 221)
- Restyling or changing any save/restart/chat behavior

## Completed

**Date:** 2026-07-11

### Summary
Decomposed all three flagged files into focused modules. `use-ops-chat.ts` (215 lines → 129) now composes two extracted modules: `ops-chat-context.ts` holds the pure helpers (`genId`, `getConfirmText`, `buildContextString`) and `use-ops-session.ts` encapsulates session init, resetting state, and `resetSession`. `container-row.tsx` (251 lines) was split into sibling files — `mobile-container-row.tsx`, `desktop-container-row.tsx`, and `container-row-utils.ts` (shared types/helpers) — with `container-row.tsx` becoming a 4-line re-export barrel; the shared restart state machine was extracted into `use-restart-confirm.ts`. `project-settings-panel.tsx` (220 lines → 201) had its inline `useSave` hook promoted to `lib/use-settings-section.ts` with a 3-test suite covering success, error, and non-Error fallback cases.

### Files changed
- `apps/dashboard/src/lib/use-ops-chat.ts` — stripped pure helpers and session logic; composes useOpsSession
- (new) `apps/dashboard/src/lib/ops-chat-context.ts` — genId, getConfirmText, buildContextString
- (new) `apps/dashboard/src/lib/use-ops-session.ts` — useOpsSession hook (sessionId, resetting, resetSession)
- (new) `apps/dashboard/src/lib/use-restart-confirm.ts` — useRestartConfirm hook
- `apps/dashboard/src/components/detail/container-row.tsx` — rewritten as 4-line re-export barrel
- (new) `apps/dashboard/src/components/detail/mobile-container-row.tsx` — MobileContainerRow using useRestartConfirm
- (new) `apps/dashboard/src/components/detail/desktop-container-row.tsx` — DesktopContainerRow + RestartSparkline
- (new) `apps/dashboard/src/components/detail/container-row-utils.ts` — stateBadge, buildLabel, ContainerMetrics
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — imports useSettingsSection from lib
- (new) `apps/dashboard/src/lib/use-settings-section.ts` — useSettingsSection hook + SectionState type
- (new) `apps/dashboard/src/lib/use-settings-section.test.ts` — 3 tests for save success/failure/fallback

### Verification
- `pnpm nx test dashboard`: 169/169 pass (17 test files)
- `pnpm nx typecheck dashboard`: clean
- `pnpm nx lint dashboard`: clean

### Follow-ups
- `[defer]` DesktopContainerRow (139 lines) could be split further if it grows — currently fine
