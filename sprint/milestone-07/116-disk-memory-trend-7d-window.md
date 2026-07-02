# Sprint 116 — Disk/memory trend: extend window to 7 days

> _Promoted from sprint-85 follow-up, 2026-06-28._

**Difficulty:** 1

## Goal

Change the data window for disk-trend and memory-trend route handlers from 48 hours to 7 days (168 hours) so the linear regression slope is based on a smoother, less bursty signal.

## Context

`apps/api/src/routes/history.ts` contains two route handlers (`/projects/:name/disk-trend` and `/projects/:name/memory-trend`). Both use:
```ts
const cutoff = Math.floor(Date.now() / 1000) - 48 * 3600
```

Sprint-85 deferred widening this to 7 days because the regression was giving misleading projections for bursty disk usage over short windows. A 168h window is smoother and produces more conservative, actionable projections.

The client-side hooks (`apps/dashboard/src/lib/use-disk-trend.ts` and `use-memory-trend.ts`) call these endpoints with no query parameters — no client changes are needed.

## Tasks

1. Open `apps/api/src/routes/history.ts`. Find the two `const cutoff = ... - 48 * 3600` lines (around lines 158 and 198).
2. Change both from `48 * 3600` to `7 * 24 * 3600` (168 hours).
3. Run `pnpm nx typecheck api --skip-nx-cache`. Confirm clean.

## Files involved

- `apps/api/src/routes/history.ts` — two cutoff constants

## Acceptance criteria

- [x] Both disk-trend and memory-trend cutoffs use `7 * 24 * 3600` (168h)
- [x] `pnpm nx typecheck api --skip-nx-cache` clean

## Completed

**Date:** 2026-06-29

### Summary
Changed the disk-trend and memory-trend cutoff windows from 48 hours to 7 days (168 hours) in the history route handlers. This gives the linear regression a smoother, less bursty signal for projecting disk/memory exhaustion dates.

### Files changed
- `apps/api/src/routes/history.ts` — changed both `48 * 3600` cutoffs to `7 * 24 * 3600`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- Code inspection: both cutoff lines at 158 and 198 confirmed updated

### Follow-ups
- none

## Out of scope

- Making the window configurable via query param
- Changing the regression algorithm
- Updating tests (the existing tests mock data, not the cutoff constant)
