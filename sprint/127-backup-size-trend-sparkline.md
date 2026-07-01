# Sprint 127 — Backup size trend sparkline

**Difficulty:** 2

## Goal

Add a small SVG sparkline inside the backup panel that charts dump sizes across the visible backups, making data-growth anomalies immediately visible.

## Reason

A table of sizes tells you the current state but not the trend. A steadily growing dump is expected; a sudden spike (index bloat, runaway audit log, accidental data import) shows up at a glance on a sparkline. The data is already available from the list endpoint — this sprint is pure visualization.

## Context

- `apps/dashboard/src/components/detail/backup-panel.tsx` — created in sprint 126. Add the sparkline inside this file (or in a small extracted component if the file is approaching 200 lines).
- `apps/dashboard/src/components/detail/container-row.tsx` — contains `RestartSparkline`, an SVG `<polyline>` sparkline. Use the same pattern: normalize values to a 0–height coordinate range, build a `points` string, render `<svg><polyline /></svg>` inline. No charting library needed.
- The `backups` array from `useBackups` is already sorted newest-first. Reverse it before plotting so the sparkline reads left = oldest, right = newest.
- Only render the sparkline if there are ≥ 2 backup entries. Hide it (return null) with fewer points.

### Sparkline spec

```
width: 120px   height: 32px   stroke: var(--fg-muted)   strokeWidth: 1.5
no axes, no labels, no fill — just the polyline
```

Normalise `sizeBytes` to the y-axis: `y = height - ((v - min) / (max - min || 1)) * height`. If all values are identical, render a flat horizontal line at mid-height.

Place it in the panel header row, to the left of the "Back up now" button, with a dim label "Size trend" in `text-[11px] text-subtle` above it.

### Size annotation

Next to the sparkline (or below the label), show the delta between the oldest and newest visible backup as a compact string:

- If newest > oldest: `+X MB` in `var(--warn)` color
- If newest < oldest: `−X MB` in `var(--ok)` color
- If equal: omit

Format the delta with `formatBytes` (already implemented in backup-panel.tsx from sprint 126).

## Tasks

1. Read `apps/dashboard/src/components/detail/container-row.tsx` lines 1–60 to confirm the exact RestartSparkline SVG pattern.
2. Read `apps/dashboard/src/components/detail/backup-panel.tsx` to understand the current layout and check line count.
3. If `backup-panel.tsx` is under ~170 lines, add `BackupSparkline` as an unexported function component at the top of the file. If it's already long, create `apps/dashboard/src/components/detail/backup-sparkline.tsx` and import it.
4. Add the sparkline + delta annotation to the panel header row.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/components/detail/backup-panel.tsx` — add sparkline to header (or import from new file)
- new file (only if needed): `apps/dashboard/src/components/detail/backup-sparkline.tsx`

## Acceptance criteria

- [x] Sparkline renders when ≥ 2 backups exist; hidden otherwise
- [x] X-axis is chronological (oldest → newest, left → right)
- [x] Flat line rendered correctly when all backup sizes are identical
- [x] Delta annotation shows correct sign and color
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `BackupSparkline` as an unexported component at the top of `backup-panel.tsx` (file was ~100 lines, well under the 170 threshold). The sparkline uses the same `<polyline>` SVG pattern as `RestartSparkline` in container-row.tsx. Normalizes `sizeBytes` values with `range = max - min || 1` to handle identical-size flat-line case. Backups are sorted newest-first from the API, reversed to oldest→newest before mapping to x-coordinates. The header row shows a "Size trend" label + sparkline + delta annotation (`+X MB` in warn or `−X MB` in ok color) only when ≥ 2 backups exist; omits delta label when sizes are equal.

### Files changed
- `apps/dashboard/src/components/detail/backup-panel.tsx` — added `BackupSparkline` function, computed sorted sizes + delta in `BackupPanel`, rendered sparkline block in header row

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Interactive tooltips on hover
- Axis labels or gridlines
- Storing historical size data server-side (uses only the currently listed backups)
