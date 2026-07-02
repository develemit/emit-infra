# Aggregate status bar on projects home page
**Difficulty:** 2

## Goal
Add a summary line in the home page topbar (and mobile header) that shows counts across all projects at a glance: how many are healthy, how many are unreachable, and whether any CI or deploys are currently running.

## Reason
With 4+ projects, you currently have to visually scan all cards to assess overall system state. A single summary line — "4 / 4 healthy" or "1 degraded · 2 CI running" — makes the home page read like a control room status board at a glance, especially useful on mobile where not all cards are visible at once.

## Context
- Home page: `apps/dashboard/app/page.tsx`
- `statuses: Record<string, ProjectStatus>` is already computed in `HomePage`. A project is healthy if `statuses[name]` exists and has no `.error`. It's unreachable if `.error` is set or if it's missing from `statuses` after load.
- `projects: ProjectSummary[] | null` holds the full list. Total count is `projects.length`.
- CI/deploy running state: `ProjectCard` currently fetches pipeline status per-card via `usePipelineStatus`. To avoid duplicating fetches in the parent, read the `ciStatus`/`deployStatus` from `statuses` if available — but these aren't in `ProjectStatus`. Simpler: add a lightweight `useAllPipelineStatus(projects)` hook that fetches all projects' CI/deploy statuses and returns a running count. Or just derive it from the existing per-card poll by lifting the count up. The simplest correct approach: a `usePipelineRunningCount(projects)` hook in a new file `apps/dashboard/src/lib/use-pipeline-running-count.ts` that calls `getCiStatus` + `getDeployStatus` for all projects in parallel and returns `{ ciRunning: number; deployRunning: number }`, polling every 15s.
- The summary text should only render once `projects !== null` and `Object.keys(statuses).length > 0` (i.e., at least one status has resolved). Show nothing (or a skeleton) until then.
- Format: `N / M healthy` in green if all healthy, amber if any degraded, red if majority down. Separator `·` then `N CI running` (omit if 0) and `N deploying` (omit if 0).

## Tasks
1. Create `apps/dashboard/src/lib/use-pipeline-running-count.ts` — hook that fetches CI + deploy status for all projects in parallel, returns `{ ciRunning: number; deployRunning: number }`, polls every 15s. Accepts `projects: ProjectSummary[] | null`.
2. In `page.tsx`, call the hook: `const { ciRunning, deployRunning } = usePipelineRunningCount(projects)`.
3. Derive summary values from `projects` and `statuses`:
   - `total = projects.length`
   - `healthy = projects.filter(p => statuses[p.config.name] && !statuses[p.config.name].error).length`
   - `healthColor`: green if `healthy === total`, amber if `healthy >= total * 0.5`, red otherwise
4. Build `summaryParts: string[]`: start with `${healthy} / ${total} healthy`, then push `${ciRunning} CI running` if `ciRunning > 0`, `${deployRunning} deploying` if `deployRunning > 0`.
5. Render the summary in the desktop topbar after the existing `"N managed"` div, separated by a `·`. Style: `text-[12px] font-mono` with `healthColor`.
6. On mobile, add a one-line summary below the "Projects" title in the mobile header (small font, muted).

## Files involved
- `apps/dashboard/src/lib/use-pipeline-running-count.ts` — new hook
- `apps/dashboard/app/page.tsx` — use hook, render summary in both topbar and mobile header

## Acceptance criteria
- [x] Desktop topbar shows `N / M healthy` with correct color
- [x] When CI or deploys are running, the count appends to the summary line
- [x] Summary is absent (not "0 / 0") until statuses have loaded
- [x] Mobile header also shows summary
- [x] `pnpm typecheck` passes

## Completed

**Date:** 2026-06-20

### Summary
Created `use-pipeline-running-count.ts`, a hook that polls CI and deploy status for all projects in parallel every 15s and returns `{ ciRunning, deployRunning }`. In `page.tsx`, derived `healthy` / `total` counts from the existing `statuses` map, computed a color-coded summary string, and rendered it in both the desktop topbar (after "N managed") and the mobile header (below the "Projects" title in a flex column). Summary only renders once `projects !== null && Object.keys(statuses).length > 0`.

### Files changed
- (new) `apps/dashboard/src/lib/use-pipeline-running-count.ts` — hook polling all projects' CI/deploy status every 15s
- `apps/dashboard/app/page.tsx` — imports hook, derives summary, renders in topbar and mobile header

### Verification
- `pnpm typecheck` (dashboard): clean

### Follow-ups
- `[defer]` The `healthColor` computation uses `total * 0.5` as amber threshold — could be made configurable if the user wants a tighter alert (e.g. any degraded = amber)

## Out of scope
- Average uptime across projects (requires per-project uptime history fetches — defer)
- Clicking summary to filter cards by health state
- Historical healthy/unhealthy ratio
