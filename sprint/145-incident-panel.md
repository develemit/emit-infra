# Sprint 145 — Uptime incident panel

**Difficulty:** 2

## Goal

Add a dashboard panel on the project detail page showing a timeline of recent downtime incidents, each with start time, duration, and resolved status, plus a MTTR (mean time to recover) stat.

## Reason

Sprint 144 exposes structured incident data; this sprint makes it visible. A list of incidents with durations gives operators the answer to "are we getting more reliable?" at a glance — something that's previously only discoverable by correlating push notifications or reading logs.

## Context

- Builds on sprint 144: `GET /projects/:name/incidents` returns `{ incidents: [{ startedAt, resolvedAt, durationSec, resolved }], mttrSec }`.
- Add `getIncidents(name)` to `apps/dashboard/src/lib/api.ts`.
- Component: `apps/dashboard/src/components/detail/incident-panel.tsx`. Card with title "Uptime Incidents" and `alert` icon.
  - MTTR stat at top: "MTTR: X min" or "MTTR: —" if no resolved incidents. Format: if < 60s show seconds, if < 3600s show minutes, else hours.
  - List of incidents, most recent first. Per row:
    - Timestamp: formatted as relative (`ageLabel` pattern, e.g. "3h ago")
    - Duration: `durationSec` formatted as "Xm Ys" or "ongoing" if `resolved: false`
    - Badge: `resolved: true` → ok/green "Resolved", `false` → err/red "Ongoing"
  - If `incidents.length === 0`: show "No incidents recorded" in subtle mono text.
  - Limit display to last 20 incidents.
  - No refresh button — loads once on mount (data changes only when monitor runs).
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` after `DeployTimeline` and before `CiTimeline`. Always visible (a short list is informative even if empty).

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 20 lines) to confirm fetch pattern.
2. Add `Incident` interface and `getIncidents(name: string)` to `apps/dashboard/src/lib/api.ts`.
3. Create `apps/dashboard/src/components/detail/incident-panel.tsx`.
4. Mount `<IncidentPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` after `<DeployTimeline .../>`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `Incident` interface and `getIncidents`
- new file: `apps/dashboard/src/components/detail/incident-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel renders one row per incident with timestamp, duration, and status badge
- [x] Ongoing (unresolved) incidents shown with error badge and "ongoing" duration
- [x] MTTR stat shown at top (or "—" if no resolved incidents)
- [x] "No incidents recorded" shown when list is empty
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `Incident`/`IncidentsResponse` interfaces and `getIncidents()` fetch to `api.ts`. Created `IncidentPanel` with alert icon, MTTR stat formatted as seconds/minutes/hours, per-incident rows with relative timestamp, colored Badge (Resolved=ok, Ongoing=err), and "Xm Ys" duration formatting. Empty state shows "No incidents recorded". Mounted after DeployTimeline in page.tsx.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `Incident`, `IncidentsResponse`, `getIncidents`
- (new) `apps/dashboard/src/components/detail/incident-panel.tsx` — incident log panel
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `IncidentPanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Filtering by date range
- HTTP probe incidents (listed if present, but no separate section)
- Acknowledging / resolving incidents manually
