# Sprint 64 — Show uptime % chip on ProjectCard list view

**Depends on:** Sprint 62 (`MetricPoint.up` field), Sprint 63 (`computeUptimePct`)

## Goal

Surface the 24h uptime percentage on each project card in the list view
(`/` dashboard page), matching the chip style used for SSL expiry and deploy age.

## Context

`ProjectCard` (`apps/dashboard/src/components/project-card.tsx`) shows region,
SSL expiry, and deployed-ago chips in a badge row. It does not currently read
metric history.

The list page renders one `<ProjectCard>` per project. Each card only has
`ProjectSummary` and `ProjectStatus` — no metric history.

To show uptime % per card, each card needs its own `useUptimePct(name)` hook
that reads from localStorage without writing (read-only). This avoids lifting
the hook call into the list page and keeps the card self-contained.

## Tasks

1. Create `apps/dashboard/src/lib/use-uptime-pct.ts`:
   - Reads the localStorage key used by `useMetricHistory` for the given `name`.
   - Parses the stored `MetricPoint[]` (defaults `up ?? true` for old points).
   - Calls `computeUptimePct` from sprint 63 and returns the result.
   - Returns `null` when no history is found or history has < 2 points.
   - This hook is read-only — it never writes to localStorage.

2. In `ProjectCard`, call `useUptimePct(name)` and render a chip in the badge
   row when the value is not null:
   ```tsx
   {uptimePct != null && (
     <span
       className="text-[11px] font-mono px-1.5 py-0.5 rounded"
       style={{
         color: uptimePct < 95 ? 'var(--err)' : 'var(--subtle)',
         background: 'var(--card-2)',
         border: '1px solid var(--border)',
       }}
     >
       {uptimePct}% up
     </span>
   )}
   ```
   Place it after the SSL chip and before the deployed-ago chip.

3. The chip should only appear once enough history has accumulated (>= 2 points),
   matching the behavior of the ResourceChart "collecting data…" empty state.

## Acceptance criteria

- Each ProjectCard shows `XX% up` chip when >= 2 metric history points exist
  for that project.
- Chip text is red when uptime < 95%, muted otherwise.
- No chip shown when history is absent or insufficient (< 2 points).
- TypeScript compiles clean.
- No change to the chart or detail page rendering.

## Completed

**Date:** 2026-06-15

### Summary
Created `use-uptime-pct.ts` — a read-only hook that reads the same localStorage key as `useMetricHistory`, backfills `up ?? true` for old points, and returns `computeUptimePct(history)`. Wired it into `ProjectCard` which now calls `useUptimePct(name)` and renders an `XX% up` chip in the badge row between the SSL chip and the deployed-ago chip. The chip only appears when `uptimePct != null` (i.e. >= 2 points in history), is muted when >= 95%, and red when below 95%.

### Files changed
- (new) `apps/dashboard/src/lib/use-uptime-pct.ts` — read-only hook computing uptime % from localStorage
- `apps/dashboard/src/components/project-card.tsx` — imports `useUptimePct`, calls it, renders the chip

### Verification
- `pnpm exec tsc --noEmit` in `apps/dashboard`: clean

### Follow-ups

- `[defer]` `useUptimePct` reads from localStorage once on mount — the chip won't update live if the detail page writes new points while the list page is open. Acceptable for now; could be fixed with a `storage` event listener if real-time sync becomes desirable.
