# Sprint 111 — Split large components, return type annotations, SETUP.md

**Difficulty:** 2

## Goal

Split `container-table.tsx` (285 lines) and `full-chart.tsx` (252 lines) to stay under the 300-line target, add explicit return type annotations to async route handler functions, and write a `SETUP.md` documenting required env vars.

## Reason

`container-table.tsx` and `full-chart.tsx` both approach the cognitive load limit and mix presentation with data transformation. Splitting them makes each piece independently readable. Separately, async route handlers in `ops.ts` and `projects.ts` lack explicit return types, which silently masks type mismatches in refactors. Finally, `NEXT_PUBLIC_API_URL` and `API_SECRET` are undocumented — a developer joining the project must grep the codebase to discover what env vars are needed.

## Context

### container-table.tsx split
- `apps/dashboard/src/components/detail/container-table.tsx` — read it fully. The likely split: extract a `ContainerRow` subcomponent for the per-row render, and a `useContainerActions` hook (or inline helper) for the restart logic. Target: main file under 180 lines.

### full-chart.tsx split
- `apps/dashboard/src/components/detail/full-chart.tsx` — read it fully. The likely split: extract chart-specific config/scale helpers into a sibling `full-chart-helpers.ts` (pure functions, no React). Target: main file under 180 lines.

### Return type annotations
- `apps/api/src/routes/ops.ts` and `apps/api/src/routes/projects.ts` — find exported async functions that are missing explicit return type annotations (e.g., `async function opsRoutes(app: FastifyInstance)` likely has no return type). Add `: Promise<void>` or the appropriate type. Don't add annotations to internal helper functions not exported.

### SETUP.md
- Create `SETUP.md` at the repo root (not in a subdirectory). Document:
  - Prerequisites: Node version, pnpm version
  - `apps/api/.env` required vars: `PORT` (default 7001), `API_SECRET` (optional, for auth)
  - `apps/dashboard/.env.local` required vars: `NEXT_PUBLIC_API_URL` (default http://localhost:7001), `NEXT_PUBLIC_API_SECRET` (optional, matches API_SECRET)
  - How to run: `pnpm dev`, `pnpm build`, `pnpm typecheck`
  - Where SSH keys need to be for the API to reach project servers

## Tasks

1. Read `apps/dashboard/src/components/detail/container-table.tsx` fully. Extract `ContainerRow` as a subcomponent (same file or sibling file). Verify main file is under 200 lines.
2. Read `apps/dashboard/src/components/detail/full-chart.tsx` fully. Extract pure chart helper functions (scale computation, data transforms) into `full-chart-helpers.ts`. Verify main file is under 200 lines.
3. Read `apps/api/src/routes/ops.ts` and `projects.ts`. Add `: Promise<void>` return type to exported route registration functions. Add return types to any other exported async functions that lack them.
4. Create `SETUP.md` at the repo root documenting env vars and dev workflow.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache` and `pnpm nx typecheck api --skip-nx-cache`.

## Files involved

- `apps/dashboard/src/components/detail/container-table.tsx` — extract ContainerRow subcomponent
- (new) `apps/dashboard/src/components/detail/container-row.tsx` — or inline subcomponent, whichever keeps the split clean
- `apps/dashboard/src/components/detail/full-chart.tsx` — extract pure helpers
- (new) `apps/dashboard/src/components/detail/full-chart-helpers.ts` — pure scale/data helpers
- `apps/api/src/routes/ops.ts` — add return type annotations
- `apps/api/src/routes/projects.ts` — add return type annotations
- (new) `SETUP.md` — env var and dev workflow documentation

## Acceptance criteria

- [x] `container-table.tsx` is under 200 lines after extraction
- [x] `full-chart.tsx` is under 200 lines after extraction
- [x] Exported async route handler functions in `ops.ts` and `projects.ts` have explicit return types
- [x] `SETUP.md` exists at repo root and documents all required env vars
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean
- [x] `pnpm nx typecheck api --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Extracted `MobileContainerRow` and `DesktopContainerRow` subcomponents (plus `RestartSparkline`) into `container-row.tsx`, bringing `container-table.tsx` from 295 to 141 lines. For `full-chart.tsx`, extracted six pure helper functions (toPolyline, deployX, formatTimeLabel, formatTooltipTime, timeLabels, filterVisibleDeploys, getChartDimensions) plus the `HoverState` interface into `full-chart-helpers.ts`, bringing `full-chart.tsx` from 252 to 198 lines. Added `Promise<void>` return types to all exported async route handler functions in `ops.ts` and `projects.ts`. Created `SETUP.md` at repo root documenting prerequisites, env vars, dev workflow, and SSH key requirements. Fixed a pre-existing type error in `history.test.ts` where the `mockProject` config fixture was missing the `serverType` field that was added in an earlier sprint.

### Files changed
- `apps/dashboard/src/components/detail/container-table.tsx` — removed extracted components (295 → 141 lines)
- (new) `apps/dashboard/src/components/detail/container-row.tsx` — MobileContainerRow, DesktopContainerRow, RestartSparkline
- `apps/dashboard/src/components/detail/full-chart.tsx` — removed extracted helpers + HoverState (252 → 198 lines)
- (new) `apps/dashboard/src/components/detail/full-chart-helpers.ts` — pure chart helpers + HoverState interface
- `apps/api/src/routes/ops.ts` — added Promise<void> return types to route handlers
- `apps/api/src/routes/projects.ts` — added Promise<void> return types to route handlers
- `apps/api/src/routes/history.test.ts` — added missing serverType to mockProject fixture
- (new) `SETUP.md` — env var and dev workflow documentation

### Verification
- `container-table.tsx`: 141 lines (under 200)
- `full-chart.tsx`: 198 lines (under 200)
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` Coverage thresholds at 50% — raise after more tests are added
- `[defer]` `container-row.tsx` and `full-chart-helpers.ts` have no unit tests

## Out of scope

- Adding return types to every function in the codebase — only exported async handlers
- Testing the extracted helpers (can follow separately)
- Documenting non-env-var setup steps beyond what's needed for a first `pnpm dev`
