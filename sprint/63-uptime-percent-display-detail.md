# Sprint 63 — Compute and display uptime % in ResourceChart and HealthCard

**Depends on:** Sprint 62 (`MetricPoint.up` field must be present)

## Goal

Show a computed uptime percentage in the project detail view — both in the
ResourceChart header and as a StatTile in HealthCard.

## Context

After sprint 62, `history` from `useMetricHistory` has `up: boolean` on each
point. We can compute uptime % as:

```ts
function computeUptimePct(history: MetricPoint[]): number | null {
  if (history.length === 0) return null
  const upCount = history.filter(p => p.up).length
  return Math.round((upCount / history.length) * 100)
}
```

Two places in the detail view should show this:

1. **ResourceChart header** — a small chip next to the "24h" badge, e.g. `99% up`
2. **HealthCard** — a new `StatTile` in the desktop 4-col grid and the mobile
   2-col grid, e.g. icon `activity`, label `Uptime 24h`, value `99%`

`HealthCard` does not currently have access to metric history — it receives
`ProjectSummary` and `ProjectStatus` as props. The uptime % must be passed in
as a new optional prop `uptimePct?: number | null`.

The detail page (`app/projects/[name]/page.tsx`) is the right place to compute
it, but it currently delegates all metric history logic to `ResourceChart`.
Options:

- **Option A**: Lift the `useMetricHistory` call up into the page and pass
  `history` or `uptimePct` down to both `ResourceChart` and `HealthCard`.
- **Option B**: Create a thin `useUptimePct(name)` hook that reads localStorage
  directly without re-recording (read-only), and call it in `HealthCard` itself.

Use **Option A** — keep the single source of truth in the page.

## Tasks

1. Add `computeUptimePct(history: MetricPoint[]): number | null` to
   `metric-history.ts` (or a sibling `uptime.ts` if the file is approaching
   300 lines).
2. In the detail page, call `useMetricHistory` at the page level (lifting it
   out of `ResourceChart`). Pass `history` down to `ResourceChart` instead of
   letting it call the hook internally.
3. Compute `uptimePct` in the page and pass it to both `<ResourceChart>` and
   `<HealthCard>`.
4. In `ResourceChart`, add a chip in the header: when `uptimePct != null`,
   render `<span>{uptimePct}% up</span>` next to the "24h" badge.
5. In `HealthCard`, accept `uptimePct?: number | null` and add a `StatTile`
   with `icon="activity"`, `label="Uptime 24h"`,
   `value={uptimePct != null ? \`${uptimePct}%\` : '—'}`.
   - Color the value `var(--err)` when `uptimePct != null && uptimePct < 95`.

## Acceptance criteria

- ResourceChart header shows `XX% up` chip when history has >= 2 points.
- HealthCard shows `Uptime 24h` StatTile on both desktop and mobile grids.
- Value is `—` until enough history accumulates (< 2 points).
- Value is red when uptime < 95%.
- TypeScript compiles clean.

## Completed

**Date:** 2026-06-15

### Summary
Lifted `useMetricHistory` out of `ResourceChart` and into the detail page so both `ResourceChart` and `HealthCard` can consume the same history. Added `computeUptimePct` to `metric-history.ts` (returns null when < 2 points). `ResourceChart` now accepts `history` and `uptimePct` as props instead of calling the hook itself; the header shows an `XX% up` chip when uptimePct is non-null. `HealthCard` gets `uptimePct?: number | null` and renders a new `Uptime 24h` StatTile in both the desktop 4-col and mobile 2-col grids, colored red when below 95%.

### Files changed
- `apps/dashboard/src/lib/metric-history.ts` — added `computeUptimePct` export
- `apps/dashboard/src/components/detail/resource-chart.tsx` — props changed to `{name, history, uptimePct}`, hook lifted out, chip added to header
- `apps/dashboard/src/components/detail/health-card.tsx` — added `uptimePct` prop, `Uptime 24h` StatTile in desktop + mobile grids
- `apps/dashboard/app/projects/[name]/page.tsx` — imports `useMetricHistory`/`computeUptimePct`, lifts hook call to page level, passes `history`+`uptimePct` to `ResourceChart` and `uptimePct` to `HealthCard`

### Verification
- `pnpm exec tsc --noEmit` in `apps/dashboard`: clean

### Follow-ups

- none
