# Sprint 117 — Extract health page helper functions

> _Promoted from sprint-113 follow-up + backlog item, 2026-06-29._

**Difficulty:** 1

## Goal

Pull the pure helper functions and `FleetRow` type out of `apps/dashboard/app/health/page.tsx` into a sibling file, bringing the component from 308 lines down to ≤220.

## Context

`apps/dashboard/app/health/page.tsx` is 308 lines. The first ~90 lines (after imports) are all pure functions and one interface that have nothing to do with React state or rendering:

- `interface FleetRow` (lines 17–22)
- `pctColor`, `ciColor`, `sslDays`, `sslColor`, `sslLabel` (pure presentational helpers)
- `backupAgeHours`, `backupColor`, `backupLabel` (backup display helpers)
- `deployAge` (relative time helper)
- `rowLevel` (core triage logic — `'fail' | 'warn' | 'ok'`)
- `httpColor` (HTTP status color)

These are not exported anywhere; they're currently module-local to the page. Extracting them to a sibling file makes `rowLevel` independently testable and keeps the component focused on data loading and rendering.

## Tasks

1. Read `apps/dashboard/app/health/page.tsx` in full to confirm the exact set of functions and their boundaries.
2. Create `apps/dashboard/app/health/helpers.ts` and move all the pure functions and the `FleetRow` interface there. Export each one.
3. Update `apps/dashboard/app/health/page.tsx` to import from `./helpers` instead of defining inline.
4. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Confirm clean.
5. Verify `wc -l apps/dashboard/app/health/page.tsx` is ≤220.

## Files involved

- (new) `apps/dashboard/app/health/helpers.ts` — all extracted helpers + FleetRow type
- `apps/dashboard/app/health/page.tsx` — remove extracted code, add import

## Acceptance criteria

- [x] `apps/dashboard/app/health/helpers.ts` exists and exports `FleetRow`, `rowLevel`, and all color/label helpers
- [x] `apps/dashboard/app/health/page.tsx` is ≤220 lines
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-29

### Summary
Extracted 12 pure helper functions and the `FleetRow` interface from `page.tsx` into a new sibling `helpers.ts` (99 lines). The component dropped from 309 to 220 lines — back under the 300-line target. All extracted symbols are exported, making `rowLevel` independently testable.

### Files changed
- (new) `apps/dashboard/app/health/helpers.ts` — FleetRow interface + all color/label/triage helpers
- `apps/dashboard/app/health/page.tsx` — removed extracted code, added import from `./helpers`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `wc -l page.tsx`: 220 lines (was 309)

### Follow-ups
- none
