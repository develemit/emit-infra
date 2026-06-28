# Sprint 93 — SSL expiry badge + memory trend projection

**Difficulty:** 2

## Goal

Add color-coded SSL expiry countdowns to the project card and health card, and surface a "memory full in N days" projection alongside the existing disk trend on the project detail page.

## Reason

Both are zero-new-infrastructure wins: `sslExpiry` is already in the status API and `mem` is already in `.metrics.jsonl`. Without them, SSL certificates can expire silently and memory pressure can build unnoticed. These give early warning on two common outage causes.

## Context

- `apps/dashboard/src/components/detail/health-card.tsx` already has a `sslDaysLeft()` helper (line 30–38) but only colors below 14 days (warn) and expired (err). No green tier, no red for <7d, and the project card doesn't show SSL at all.
- `apps/dashboard/src/components/project-card.tsx` — check how it currently renders health chips; SSL badge should slot in here without restructuring.
- Memory trend uses the exact same linear-regression logic as disk trend in `apps/api/src/routes/history.ts` (`/projects/:name/disk-trend`, lines 142–178). Duplicate the endpoint for memory using the `mem` field.
- `apps/dashboard/src/lib/use-disk-trend.ts` — copy this hook for memory.
- Project detail page (`apps/dashboard/app/projects/[name]/page.tsx`) uses `useDiskTrend` — add `useMemoryTrend` alongside it.
- Disk trend is displayed somewhere in the detail page UI (search for `diskTrend` or `projectedDays` in `apps/dashboard/app/projects/[name]/page.tsx` and its imported components).

## Tasks

1. Read `health-card.tsx`, `project-card.tsx`, the detail page, and `use-disk-trend.ts` to understand existing patterns.
2. **SSL badge color fix** — update `sslDaysLeft()` in `health-card.tsx`:
   - `< 7d` → `var(--err)` (red)
   - `7–30d` → `var(--warn, #e5a00d)` (yellow)
   - `> 30d` → `var(--ok, #22c55e)` (green)
3. **SSL on project card** — add a small SSL expiry chip to `project-card.tsx` using the same threshold colors. Show `Xd` or `Expired`. Only render if `status.sslExpiry` is present.
4. **Memory trend API** — in `history.ts`, add `GET /projects/:name/memory-trend` using the same regression as disk-trend but reading `p.mem` instead of `p.disk`. Same response shape: `{ mem, pctPerDay, projectedDaysUntilFull }`.
5. **`useMemoryTrend` hook** — create `apps/dashboard/src/lib/use-memory-trend.ts` as a copy of `use-disk-trend.ts` targeting the new endpoint.
6. **Display on detail page** — in the project detail page, call `useMemoryTrend(name)` and render the projection near the disk projection. Show "Mem full in ~Nd" (or "stable" if slope ≤ 0). Match the existing disk trend display style exactly.
7. Run `pnpm nx typecheck dashboard` and `pnpm nx typecheck api`.

## Files involved

- `apps/dashboard/src/components/detail/health-card.tsx` — fix SSL color tiers
- `apps/dashboard/src/components/project-card.tsx` — add SSL expiry chip
- `apps/api/src/routes/history.ts` — add `/projects/:name/memory-trend` endpoint
- (new) `apps/dashboard/src/lib/use-memory-trend.ts` — hook for memory trend data
- `apps/dashboard/app/projects/[name]/page.tsx` — wire `useMemoryTrend`, render projection

## Acceptance criteria

- [x] SSL badge on project card shows green (>30d), yellow (7–30d), red (<7d / expired)
- [x] SSL display in health card uses same three-tier color scheme
- [x] `GET /projects/:name/memory-trend` returns `{ mem, pctPerDay, projectedDaysUntilFull }`
- [x] Memory projection renders on project detail page alongside disk projection
- [x] `pnpm nx typecheck dashboard` and `pnpm nx typecheck api` both clean

## Out of scope

- Alerts / push notifications for expiring certs (separate sprint)
- SSL renewal automation
- Historical memory trend chart (the chart already exists; this only adds the projection text)

## Completed

**Date:** 2026-06-28

### Summary
Updated `sslDaysLeft()` in both `health-card.tsx` and `project-card.tsx` to use a proper three-tier color scheme: red for <7 days, yellow for 7–30 days, green for >30 days. The project card previously hid the SSL badge entirely when days >30 — that guard was removed so all projects with `sslExpiry` show their SSL health. Added a `GET /projects/:name/memory-trend` endpoint to the API (exact copy of disk-trend using `p.mem`), wired it up via a new `useMemoryTrend` hook, and rendered the projection on the project detail page alongside the existing disk trend banner.

### Files changed
- `apps/dashboard/src/components/detail/health-card.tsx` — 3-tier SSL color thresholds
- `apps/dashboard/src/components/project-card.tsx` — 3-tier SSL colors, removed `ssl.days <= 30` guard
- `apps/api/src/routes/history.ts` — new `/projects/:name/memory-trend` endpoint
- `apps/dashboard/src/lib/api.ts` — `MemoryTrend` interface + `getMemoryTrend` function
- (new) `apps/dashboard/src/lib/use-memory-trend.ts` — polling hook for memory trend
- `apps/dashboard/app/projects/[name]/page.tsx` — import + call `useMemoryTrend`, render projection

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- none
