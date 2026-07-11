# Frontend composition: extract FilterTabs component and useBackupPolling hook
**Difficulty:** 3

## Goal
The duplicated filter-tab JSX in the CI and health pages is one shared `FilterTabs` component, and the backup panel's 8-useState polling state machine lives in a `useBackupPolling` hook with unit tests.

## Reason
2026-07-10 audit (frontend composition pillar): two near-identical ~45-line filter-tab blocks (`apps/dashboard/app/ci/page.tsx:123-167` and `apps/dashboard/app/health/page.tsx:91-135`) — classic copy-paste drift risk. Separately, `backup-panel.tsx` runs an 8-useState polling state machine inline in the component; per house rules ("React stateful logic → custom hooks"), it wants to be its own testable hook. Sprint 211's investigation confirmed the polling logic (elapsed timer, timeout feedback from sprints 180/194) is worth protecting with tests.

## Context
- `apps/dashboard/app/ci/page.tsx:123-167` and `apps/dashboard/app/health/page.tsx:91-135` — compare the two blocks before extracting; note any prop differences (tab labels, counts, active styling) and design the component API around the union.
- `apps/dashboard/src/components/` — existing shared-component conventions; put `FilterTabs` wherever other cross-page components live (check for a shared/ or ui/ folder).
- `apps/dashboard/src/components/detail/backup-panel.tsx` — the 8 useStates cover: polling active, elapsed seconds, timeout state, backup list, trigger in-flight, error, and related. Read carefully to map the actual state machine before extracting.
- Hook target: `apps/dashboard/src/lib/use-backup-polling.ts` (or hooks/ folder if one exists) — component keeps rendering only; hook owns intervals, elapsed timer, timeout transition, cleanup.
- Test setup: dashboard tests use vitest + testing-library (see `container-row.test.tsx` from sprint 210). Use `renderHook` + `vi.useFakeTimers()` for the polling hook. Gotcha: fake timers + async polling need `vi.advanceTimersByTimeAsync`.
- No visual or behavior changes — this is pure extraction.

## Tasks
1. Diff the two filter-tab blocks; write `FilterTabs` with the minimal prop API covering both call sites; replace both inline blocks.
2. Map backup-panel's state machine; extract `useBackupPolling` returning the state + actions the component needs; slim the component to rendering.
3. Write `use-backup-polling.test.ts`: polling starts/stops correctly, elapsed timer ticks, timeout state fires at the threshold, cleanup on unmount clears intervals.
4. Optionally add a small `FilterTabs` render test (tabs render, click fires callback).
5. Run `pnpm nx test dashboard`, `pnpm nx typecheck dashboard`, `pnpm nx lint dashboard`.

## Files involved
- new file: `apps/dashboard/src/components/` `filter-tabs.tsx` (location per existing conventions)
- new file: `apps/dashboard/src/lib/use-backup-polling.ts` + test file
- `apps/dashboard/app/ci/page.tsx` — replace inline block
- `apps/dashboard/app/health/page.tsx` — replace inline block
- `apps/dashboard/src/components/detail/backup-panel.tsx` — slims to rendering

## Acceptance criteria
- [x] Both pages render identical tabs via the shared component; no visual change
- [x] backup-panel.tsx no longer owns polling state; hook is unit-tested including timeout and cleanup
- [x] Tests pass, typecheck clean, lint clean

## Out of scope
- Restyling or changing tab/polling behavior
- Extracting other duplicated JSX found along the way (add `[defer]` notes)
- Detail-page reorg (separate initiative)

## Completed

**Date:** 2026-07-11

### Summary
Extracted the duplicated ~45-line filter-tab JSX from `ci/page.tsx` and `health/page.tsx` into a shared `FilterTabs` component at `src/components/ui/filter-tabs.tsx`. The component accepts a `tabs` array where each tab has an optional `count` — when count is undefined the button renders disabled (loading state); when present it shows `Label (N)`. Both pages now pass computed counts from their data and share the same rendering logic with no visual change.

Separately extracted the 8-useState polling state machine from `backup-panel.tsx` into `use-backup-polling.ts`. The hook encapsulates the `setInterval` poll, the 600s timeout, and the elapsed-seconds timer. The component retains only rendering and non-polling local state (`confirmKey`, `retainDays`, `saving`, `saveError`). Also fixed two pre-existing lint errors in adjacent test files (`backup-panel.test.tsx` unused import, `incident-panel.test.tsx` unused destructured param).

### Files changed
- (new) `apps/dashboard/src/components/ui/filter-tabs.tsx` — shared filter-tab button row component
- `apps/dashboard/app/ci/page.tsx` — replaced inline filter block with `<FilterTabs>`
- `apps/dashboard/app/health/page.tsx` — replaced inline filter block with `<FilterTabs>`
- (new) `apps/dashboard/src/lib/use-backup-polling.ts` — polling state machine hook
- (new) `apps/dashboard/src/lib/use-backup-polling.test.ts` — 10 unit tests covering start/stop, elapsed timer, timeout, completion, cleanup
- `apps/dashboard/src/components/detail/backup-panel.tsx` — slimmed to rendering; polling via hook
- `apps/dashboard/src/components/detail/backup-panel.test.tsx` — removed unused import (pre-existing lint error)
- `apps/dashboard/src/components/detail/incident-panel.test.tsx` — removed unused destructured param (pre-existing lint error)

### Verification
- `pnpm nx test dashboard`: 137/137 pass (10 new use-backup-polling tests)
- `pnpm nx typecheck dashboard`: clean
- `pnpm nx lint dashboard`: clean

### Follow-ups
- `[defer]` The filter-tab pattern may be reusable in other list views (e.g., if a future page adds similar all/warn/fail filtering) — no action needed now
