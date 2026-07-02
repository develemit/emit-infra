# Sprint 95 — Container restart timeline sparkline

**Difficulty:** 3

## Goal

Add a per-container restart sparkline to the container table on the project detail page. Instead of a bare restart count, show how restarts have trended over the last 24 hours so it's immediately clear whether a container is crashing repeatedly right now or just has a historic count.

## Reason

A restart count of "12" is ambiguous — it could mean one crash loop this morning or twelve isolated restarts over the past month. The raw time-series is already in `.metrics.jsonl` (`containers[].restarts` per data point). Surfacing it as a sparkline turns a number into a signal.

## Context

- `.metrics.jsonl` stores a JSON line every 5 minutes. Each line includes a `containers` array where each entry has `{ name, cpu, memMb, restarts }`. Restarts is a cumulative total from `docker inspect --format "{{.RestartCount}}"`.
- `apps/api/src/routes/history.ts` — add a new endpoint `GET /projects/:name/container-restarts?hours=24` that reads `.metrics.jsonl`, filters to the requested window, and returns an object keyed by container name, each value being an array of `{ t, restarts }` points. Use `readJsonl` (already imported) and the same cutoff pattern as the existing metrics endpoint.
- `apps/dashboard/src/components/detail/container-table.tsx` — this is where each container row is rendered. Read it to understand the current row layout (columns: name, status, cpu, memory, restarts). Add a small inline sparkline after the restart count.
- For the sparkline, use a minimal inline SVG — no new library. Normalize Y across the container's restart series (min=0, max=max restarts seen). Draw a `<polyline>` across a ~60×16px SVG. Color it `var(--err)` if restarts increased in the last hour, `var(--fg-muted)` otherwise.
- `apps/dashboard/src/lib/api.ts` — add a `getContainerRestarts(name, hours)` fetch function.
- Wire a `useContainerRestarts(name)` hook (new file `apps/dashboard/src/lib/use-container-restarts.ts`) that calls the API once on mount. No polling needed — the container table already re-renders when the parent polls status.

## Tasks

1. Read `container-table.tsx` and the metrics endpoint in `history.ts` to understand structure.
2. Add `GET /projects/:name/container-restarts` to `history.ts`. Response: `{ [containerName: string]: { t: number; restarts: number }[] }`.
3. Add `getContainerRestarts(name: string, hours?: number)` to `apps/dashboard/src/lib/api.ts`.
4. Create `apps/dashboard/src/lib/use-container-restarts.ts` — fetches on mount, returns the map.
5. In `container-table.tsx`: call `useContainerRestarts` (or accept the data as a prop — whichever fits the existing pattern), render a 60×16 inline SVG sparkline in the restarts column.
6. Color logic: if the most recent restart count > the count from 1 hour ago → `var(--err)`; else `var(--fg-muted)`.
7. Run `pnpm nx typecheck dashboard` and `pnpm nx typecheck api`.

## Files involved

- `apps/api/src/routes/history.ts` — add `/projects/:name/container-restarts` endpoint
- `apps/dashboard/src/lib/api.ts` — add `getContainerRestarts` fetch function
- (new) `apps/dashboard/src/lib/use-container-restarts.ts` — data hook
- `apps/dashboard/src/components/detail/container-table.tsx` — render sparkline in restart column

## Acceptance criteria

- [x] `GET /projects/:name/container-restarts?hours=24` returns time-series keyed by container name
- [x] Container table shows a 60×16 SVG sparkline next to the restart count for each container
- [x] Sparkline is red if restarts increased in the last hour, muted otherwise
- [x] `pnpm nx typecheck dashboard` and `pnpm nx typecheck api` clean

## Out of scope

- Clickable sparkline / expanded restart history view
- Per-container log drill-down from the sparkline
- Restart alerting / push notifications

## Completed

**Date:** 2026-06-28

### Summary
Added `GET /projects/:name/container-restarts?hours=24` to `history.ts` which reads `.metrics.jsonl` and returns per-container restart time-series. Added `getContainerRestarts` to the dashboard API client and a `useContainerRestarts` hook that fetches once on mount. In `container-table.tsx`, added a `RestartSparkline` component that renders a 60×16 inline SVG polyline — red if restarts increased in the last hour vs. an hour ago, muted gray otherwise. Sparkline only renders when the container has at least one restart in the series; containers with zero restarts show nothing additional. Fixed a TypeScript strict-mode error where `result[c.name]` needed a non-null assertion after the guard check.

### Files changed
- `apps/api/src/routes/history.ts` — new `GET /projects/:name/container-restarts` endpoint
- `apps/dashboard/src/lib/api.ts` — `ContainerRestartSeries` type + `getContainerRestarts` function
- (new) `apps/dashboard/src/lib/use-container-restarts.ts` — mount-time fetch hook
- `apps/dashboard/src/components/detail/container-table.tsx` — `RestartSparkline` component + wired into restart column

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- none
