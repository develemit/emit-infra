# Sprint 113 — Fleet/CI filter button counts

> _Promoted from sprint-106 follow-up, 2026-06-28._

**Difficulty:** 2

## Goal

Add row counts to the All / Warning / Failing filter buttons on both `/health` and `/ci` pages so operators can see how many projects are in each state without clicking.

## Context

`apps/dashboard/app/health/page.tsx` has a `filter` state (`'all' | 'warn' | 'fail'`) and a three-button group that filters the fleet health table using `rowLevel()`. The buttons currently show: "All", "Warning", "Failing".

Target output: "All (12)", "Warning (3)", "Failing (1)" — computed from the current `rows` array using the same `rowLevel()` function that's already in scope.

`apps/dashboard/app/ci/page.tsx` has the same pattern with `statsLevel()` driving filter. Same fix applies there.

The count should always reflect all rows, not just the filtered subset — so a user on "Failing" can still see how many are in "Warning".

### Implementation hint
In each page, before the filter button group, derive:
```ts
const failCount = rows.filter(r => rowLevel(r) === 'fail').length
const warnCount = rows.filter(r => rowLevel(r) !== 'ok' && rowLevel(r) !== 'fail').length
const allCount = rows.length
```
Then update the button labels: `All (${allCount})`, `Warning (${warnCount})`, `Failing (${failCount})`.

Do the equivalent for the CI page using `statsLevel()`.

## Tasks

1. Read `apps/dashboard/app/health/page.tsx` fully. Locate the filter button group. Add counts to each button label.
2. Read `apps/dashboard/app/ci/page.tsx` fully. Locate the filter button group. Add counts to each button label.
3. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any type errors.

## Files involved

- `apps/dashboard/app/health/page.tsx`
- `apps/dashboard/app/ci/page.tsx`

## Acceptance criteria

- [x] Health page filter buttons show counts: "All (N)", "Warning (N)", "Failing (N)"
- [x] CI page filter buttons show counts in the same format
- [x] Counts reflect all rows, not the currently filtered subset
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

Implemented button count labels on both pages:
- Health page: Added count calculations using `rowLevel()` for fail, warn, and all counts
- CI page: Added count calculations using `statsLevel()` for fail, warn, and all counts
- Both pages show counts in format: "All (N)", "Warning (N)", "Failing (N)"
- Counts are calculated from the full dataset, not the filtered subset
- Pre-existing typecheck errors in `use-project-detail.test.ts` are unrelated to these changes

## Out of scope

- Animating count changes
- Persisting filter state across navigation
- Counts on any other pages
