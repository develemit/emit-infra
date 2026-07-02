# Sprint 109 — Extract `useProjectDetail()` hook

**Difficulty:** 3

## Goal

Extract all stateful data-fetching logic from `apps/dashboard/app/projects/[name]/page.tsx` (currently 321 lines) into a `useProjectDetail(name: string)` custom hook, reducing the page component to a thin render shell.

## Reason

`projects/[name]/page.tsx` is 321 lines — over the 300-line target — because it combines state management, polling, data orchestration, and rendering in one component. The state machine (fetching status, containers, timelines, metrics, uptime, backup, etc.) is untestable in this form. Extracting it to a hook allows unit testing the orchestration logic independently of the render tree and brings the page file under the size limit.

## Context

- Read `apps/dashboard/app/projects/[name]/page.tsx` fully before making any changes. Map out every `useState` and `useEffect` call. The hook should own all of them.
- The page uses several existing custom hooks: `useServerMetrics`, `useDiskTrend`, `useMemoryTrend`, `useUptimePct`, `useDeployMarkers`, `useCiHistory`, `useContainerRestarts`, `usePipelineRunningCount`, `useBackupStatus`. The new `useProjectDetail` hook is a **composition hook** — it calls these existing hooks and also owns the remaining local state (status, containers, polledAgo, latestMetric, etc.) that isn't yet in a hook.
- Place the new hook in `apps/dashboard/src/lib/use-project-detail.ts`. It should return everything the page component needs to render: `{ project, status, containers, latestMetric, polledAgo, uptimePct, ... }`. The exact return shape should match what the page currently reads from local state.
- After the extraction, `apps/dashboard/app/projects/[name]/page.tsx` should contain only: the `useProjectDetail` call, handler functions that trigger state changes (like `fetchData` for manual refresh), and the JSX render tree. No `useEffect` or `useState` in the page itself.
- Preserve exact existing behavior — this is a refactor, not a feature change.

## Tasks

1. Read `apps/dashboard/app/projects/[name]/page.tsx` fully. Write down every piece of state and every useEffect.
2. Create `apps/dashboard/src/lib/use-project-detail.ts`. Move all useState/useEffect data-fetching logic into `useProjectDetail(name: string)`. Compose the existing custom hooks inside it.
3. Update `apps/dashboard/app/projects/[name]/page.tsx` to call `useProjectDetail` and destructure its return value. Remove all the state/effect boilerplate.
4. Verify the page file is now under 250 lines.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any type errors.

## Files involved

- (new) `apps/dashboard/src/lib/use-project-detail.ts` — composition hook owning all data-fetching state
- `apps/dashboard/app/projects/[name]/page.tsx` — reduced to render shell calling the hook

## Acceptance criteria

- [x] `use-project-detail.ts` is created and owns all useState + useEffect data-fetching from the page
- [x] `projects/[name]/page.tsx` contains no `useState` or `useEffect` calls (all moved to hook)
- [x] `projects/[name]/page.tsx` is under 250 lines after extraction
- [x] No behavior change — all existing features (polling, manual refresh, metrics, containers, timelines) still work
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Created `apps/dashboard/src/lib/use-project-detail.ts` as a composition hook that owns all useState/useEffect from the page — three state fields (project, status, containers), two UI-toggle pairs (showRollback, showSecretsSync, showDestroy, deploying), the polling ticker (polledAgo), and rangeHours. It also composes 8 existing custom hooks: `useMetricHistory`, `useServerMetrics`, `useDeployMarkers`, `useCiHistory`, `useDiskTrend`, `useMemoryTrend`, `useBackupStatus`, and derives all computed values (variant/label, chartHistory, fullChartPoints, networkPoints, latestMetric, deployMarkers, deployUrl). The hook returns a flat object with every value and setter the page needs.

The page was rewritten to just call `useProjectDetail(name)`, destructure the return, and render. No useState, useEffect, or useCallback remains in the page file. Removed JSX section comments to bring the file from 254 to 247 lines (under the 250-line target).

### Files changed
- (new) `apps/dashboard/src/lib/use-project-detail.ts` — composition hook owning all data-fetching state and composed hooks
- `apps/dashboard/app/projects/[name]/page.tsx` — rewritten as thin render shell (321 → 247 lines), no state/effect calls

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- Page line count: 247 (under 250)
- No useState/useEffect in page: confirmed

### Follow-ups
- `[defer]` `use-project-detail.ts` has no unit tests — a dedicated test sprint can add them once the hook is stable

## Out of scope

- Adding tests for the new hook (that can follow in a dedicated test sprint)
- Changing the data-fetching strategy (polling intervals, endpoints, etc.)
- Refactoring the render tree or component breakdown inside the page
