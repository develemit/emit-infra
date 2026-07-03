# Fleet-level incident timeline at /health/incidents
**Difficulty:** 4

## Goal
A new `/health/incidents` page shows all projects' incidents on one timeline with deploy markers overlaid, so cross-project correlation ("did project A go down when project B deployed?") is visible at a glance.

## Reason
Incidents are only viewable per-project; there is no fleet view. For an operator running several servers, the interesting question during a bad day is usually cross-cutting. High-impact item from the 2026-07-02 scan; builds on sprint 189's annotations (false positives should render dimmed here too).

## Context
- The Health page exists at `apps/dashboard/app/health/page.tsx` — read it first for layout/nav conventions and to add a link to the new sub-page.
- Per-project incidents come from the history route family (`apps/api/src/routes/history.ts`); deploys likewise have their own history (see `deploys`/`deployMarkers` in `apps/dashboard/src/lib/use-project-detail.ts` and `api-history.ts` for the client calls). Sprint 189 merges annotations into incident responses.
- Fleet aggregation options: (a) new API route `GET /fleet/incidents?days=30` that loops registered projects server-side and returns `{ project, incidents[], deploys[] }[]`, or (b) client-side fan-out via existing per-project endpoints. Prefer (a) — one request, and the project list lives server-side (`findProject`/config helpers in `apps/api/src/lib/project-helpers.ts`). Reads are all local JSONL, so no SSH cost.
- Rendering: a horizontal time axis (last N days, default 7, selector for 1/7/30) with one row (swimlane) per project; incident spans as colored bars (err color, dimmed for false positives), deploy markers as thin vertical ticks. SVG is the established approach in this repo (see `deploy-cadence-chart.tsx`, `full-chart.tsx` for SVG chart patterns and time-axis helpers). Extract math into a `fleet-timeline-helpers.ts` with unit tests, mirroring `full-chart-helpers.ts` + its test file.
- Tooltips: hover on a bar shows project, start, duration, note (if annotated). Keep it simple — `title` attributes are acceptable for v1.
- Keep files ≤300 lines: page + timeline component + helpers as separate files.

## Tasks
1. Read `history.ts`, `use-project-detail.ts`, `full-chart-helpers.ts` (+test) for the data shapes and chart conventions.
2. Add `GET /fleet/incidents` aggregating incidents (with annotations) and deploys per project over a validated `days` query; test it.
3. Create `fleet-timeline-helpers.ts` (time-to-x mapping, lane layout) + unit tests.
4. Create the timeline component (SVG swimlanes, incident bars, deploy ticks, range selector).
5. Create `apps/dashboard/app/health/incidents/page.tsx`; link to it from the Health page.
6. Empty state ("No incidents in this range") and loading state.
7. Typecheck both apps; run API and dashboard tests.

## Files involved
- `apps/api/src/routes/history.ts` or new file `fleet.ts` — aggregate endpoint (+ registration)
- new file: `apps/dashboard/app/health/incidents/page.tsx`
- new file: `apps/dashboard/src/components/fleet-incident-timeline.tsx`
- new file: `apps/dashboard/src/lib/fleet-timeline-helpers.ts` (+ `.test.ts`)
- `apps/dashboard/src/lib/api-history.ts` — fleet client call
- `apps/dashboard/app/health/page.tsx` — link to the new page

## Acceptance criteria
- [x] `/health/incidents` renders one swimlane per project with incident bars and deploy ticks on a shared axis
- [x] Range selector (1/7/30 days) works; empty and loading states exist
- [x] False-positive incidents render dimmed
- [x] Helper math unit-tested; API aggregate route tested
- [x] Typecheck clean; all tests pass

## Out of scope
- Real-time updates (static fetch on load + range change is fine)
- Cost/scale-event overlays — deploys only for v1

## Completed

**Date:** 2026-07-03

### Summary
Added a fleet-wide incident timeline at `/health/incidents`. A new `GET /fleet/incidents?days=N` API route aggregates per-project incidents (with annotations merged) and recent deploys server-side. The page renders an SVG swimlane chart — one row per project, incident spans as red bars (dimmed at 0.25 opacity for false positives), deploy ticks as thin vertical lines. A 1/7/30-day range selector refetches on change; loading and empty states are handled. Math helpers live in `fleet-timeline-helpers.ts` with 18 unit tests. The Health page desktop topbar gets an "Incidents" link to the new page.

### Files changed
- (new) `apps/api/src/routes/fleet.ts` — `GET /fleet/incidents` aggregating incidents+deploys per project
- (new) `apps/api/src/routes/fleet.test.ts` — 5 API tests
- `apps/api/src/index.ts` — registered `fleetRoutes`
- (new) `apps/dashboard/src/lib/fleet-timeline-helpers.ts` — time-to-x, incidentBar, deployX, fleetTimeLabels, fmtDuration
- (new) `apps/dashboard/src/lib/fleet-timeline-helpers.test.ts` — 18 helper tests
- (new) `apps/dashboard/src/components/fleet-incident-timeline.tsx` — SVG swimlane chart component
- (new) `apps/dashboard/app/health/incidents/page.tsx` — range selector + fleet timeline page
- `apps/dashboard/src/lib/api-history.ts` — added `FleetProjectData` type + `getFleetIncidents(days)` client call
- `apps/dashboard/app/health/page.tsx` — "Incidents" link in desktop topbar

### Verification
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean
- `npx nx run api:test`: 154/154 pass
- `npx nx run dashboard:test`: 66/67 pass (1 pre-existing failure in container-row.test.tsx, confirmed pre-existing before sprint started)

### Follow-ups
- `[defer]` Fix pre-existing `MobileContainerRow > calls restartContainer and onRefetch on restart button click` test failure in `apps/dashboard/src/components/detail/container-row.test.tsx`
