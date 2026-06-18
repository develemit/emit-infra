# Full health timeline detail page with deploy correlation
**Difficulty:** 4

## Goal
A dedicated health detail view per project shows full-width charts for CPU, memory, disk, and network over selectable time ranges (24h / 7d / 30d), a per-container breakdown table with restart counts and memory, a deploy history timeline, and a CI history list. Deploy markers overlay all resource charts so any release-to-spike correlation is immediately visible.

## Reason
The sparklines on project cards (sprint 74) give a quick glance, but investigating "what happened after Tuesday's deploy" needs full-size charts with time range control, per-container drill-down (which service is using the memory?), and a complete deploy log showing SHA, duration, and which services were rebuilt. This is the "investigation view" that makes the health monitoring system useful for debugging.

## Context
- Builds on sprints 73 (API routes) and 74 (sparklines + deploy markers).
- The detail page components live in `apps/dashboard/src/components/detail/`. Existing components: `health-card.tsx`, `resource-chart.tsx`, `container-table.tsx`, `docker-usage.tsx`.
- `container-table.tsx` already shows running containers — extend it with restart counts and memory from the metrics data.
- The API's `getMetrics(name, hours)` supports up to 720 hours (30 days) with automatic downsampling.
- `getDeployHistory(name, limit)` and `getCiHistory(name, limit)` return reverse-chronological entries.
- The dashboard uses a dark theme — charts should use colors that work on dark backgrounds. Follow the existing `ResourceChart` color palette.
- Network bytes from the metrics API are cumulative (`netRxBytes`, `netTxBytes`). The chart should show the *delta* (bandwidth) between adjacent points, not cumulative totals.
- Target file size ≤300 lines per component — split into focused subcomponents.

## Tasks
1. Create a time range selector component (`apps/dashboard/src/components/detail/range-selector.tsx`):
   - Three buttons: 24h, 7d, 30d
   - Controls which `hours` value is passed to `useServerMetrics`
   - Highlight the active range

2. Create a full-width resource chart component (`apps/dashboard/src/components/detail/full-chart.tsx`):
   - Larger SVG than the card sparkline (full container width, ~200px height)
   - Renders CPU, memory, disk as separate line series with legend
   - Accepts `deploys` array and renders vertical deploy marker lines with tooltips showing SHA + timestamp
   - X-axis time labels (hourly for 24h, daily for 7d/30d)
   - Y-axis percentage labels (0%, 50%, 100%)

3. Create a network bandwidth chart (`apps/dashboard/src/components/detail/network-chart.tsx`):
   - Compute delta between adjacent `netRxBytes`/`netTxBytes` points
   - Display as area chart with rx/tx in different colors
   - Same deploy markers as the resource chart
   - Format bandwidth in human-readable units (KB/s, MB/s)

4. Extend `container-table.tsx` to show:
   - Per-container CPU % and memory (from the most recent metric point's `containers` array)
   - Restart count per container
   - Sort by memory usage descending

5. Create a deploy history list (`apps/dashboard/src/components/detail/deploy-timeline.tsx`):
   - Shows each deploy: SHA (linked/copyable), branch, timestamp, duration, services built, status badge (deployed/failed)
   - Most recent at top
   - Failed deploys highlighted in red

6. Create a CI history list (`apps/dashboard/src/components/detail/ci-timeline.tsx`):
   - Shows each CI run: SHA, branch, timestamp, duration, status badge (success/failure)
   - Most recent at top

7. Wire everything together in a health detail section that includes: range selector → full resource chart → network chart → container table → deploy timeline → CI timeline.

## Files involved
- new file: `apps/dashboard/src/components/detail/range-selector.tsx`
- new file: `apps/dashboard/src/components/detail/full-chart.tsx`
- new file: `apps/dashboard/src/components/detail/network-chart.tsx`
- new file: `apps/dashboard/src/components/detail/deploy-timeline.tsx`
- new file: `apps/dashboard/src/components/detail/ci-timeline.tsx`
- `apps/dashboard/src/components/detail/container-table.tsx` — add CPU, memory, restart count columns
- Parent detail view component (wherever the detail page is composed) — add new sections

## Acceptance criteria
- [x] Time range selector switches between 24h / 7d / 30d views
- [x] Full-width CPU/memory/disk chart renders with deploy markers
- [x] Network chart shows bandwidth (delta, not cumulative) with rx/tx lines
- [x] Container table shows per-container CPU %, memory, restart count
- [x] Deploy timeline lists all deploys with SHA, duration, services built, status
- [x] CI timeline lists all runs with SHA, duration, status
- [x] Deploy markers appear on both resource and network charts
- [x] All new components ≤300 lines each
- [x] Mobile-responsive layout
- [x] Typecheck and lint pass

## Completed

**Date:** 2026-06-18

### Summary
Built the full health detail page with investigation-grade charts. Created `RangeSelector` (24h/7d/30d toggle that drives the `hours` param on `useServerMetrics`), `FullChart` (full-width SVG with CPU/mem/disk polylines, y-axis 0%/50%/100%, adaptive x-axis time labels, 80% threshold line, and deploy markers with SHA tooltips), and `NetworkChart` (computes bandwidth delta from cumulative netRxBytes/netTxBytes, renders rx/tx area charts in green/indigo with human-readable KB/s/MB/s labels). Extended `ContainerTable` with per-container CPU%, memory (MB), and restart count columns from the latest metric point's `containers` array, sorted by memory descending. Created `DeployTimeline` and `CiTimeline` list components showing SHA (copyable), branch, timestamp, duration, services built, and status badges with failed items highlighted in red. All wired into the project detail page with a `useCiHistory` hook polling every 60s.

### Files changed
- (new) `apps/dashboard/src/components/detail/range-selector.tsx` — 24h/7d/30d toggle buttons
- (new) `apps/dashboard/src/components/detail/full-chart.tsx` — full-width resource chart with deploy markers
- (new) `apps/dashboard/src/components/detail/network-chart.tsx` — bandwidth delta area chart
- (new) `apps/dashboard/src/components/detail/deploy-timeline.tsx` — deploy history list with status badges
- (new) `apps/dashboard/src/components/detail/ci-timeline.tsx` — CI run history list
- (new) `apps/dashboard/src/lib/use-ci-history.ts` — hook polling CI history API
- `apps/dashboard/src/components/detail/container-table.tsx` — added CPU, memory, restart columns + memory-descending sort
- `apps/dashboard/app/projects/[name]/page.tsx` — wired range selector, full chart, network chart, timelines

### Verification
- `pnpm nx run dashboard:typecheck`: clean
- `pnpm nx run dashboard:lint`: clean
- All new files ≤300 lines (range-selector: 36, full-chart: 180, network-chart: 194, deploy-timeline: 77, ci-timeline: 68)
- container-table: 252 lines, page.tsx: 291 lines

### Follow-ups
- `[defer]` The existing sparkline `ResourceChart` and the new `FullChart` both render on the detail page — could consolidate or hide the sparkline when full chart is visible
- `[defer]` Deploy marker tooltips in FullChart use SVG `<title>` elements — a proper hover tooltip component would be more interactive
- `[defer]` Network chart y-axis labels recalculate on each render — could memoize for large datasets

## Out of scope
- Alerting / threshold notifications (future initiative)
- Cross-project aggregate views (future)
- Response latency / error rate metrics (requires emit-vision integration — future)
- GHCR storage tracking (could be a follow-up sprint)
