# Sprint 108 — Hook test suites + vitest coverage thresholds

**Difficulty:** 2

## Goal

Write test suites for `use-disk-trend` and `use-memory-trend` custom hooks, and configure vitest coverage thresholds in both apps' vitest configs so CI enforces a minimum floor.

## Reason

These two hooks implement the linear regression trend logic that drives the disk/memory projection display. They have no tests, and the `.catch(() => null)` pattern (improved in sprint 103) means failures are invisible. A regression in the slope calculation or the fetch URL would show wrong projections silently. Separately, without coverage thresholds in vitest config, there's nothing preventing new paths from shipping with zero tests.

## Context

- `apps/dashboard/src/lib/use-disk-trend.ts` and `use-memory-trend.ts` — both are custom hooks that call `getMetricHistory(name, hours)` and compute a slope via linear regression. They use `useState`, `useEffect`, and `apiFetch` under the hood.
- Test these hooks using `@testing-library/react` `renderHook` — check if it's already in `apps/dashboard/package.json`. If not, it may need adding.
- `apps/dashboard/src/lib/api.test.ts` — the existing dashboard test file. Look at it to understand the test setup pattern before writing new test files.
- Mock `apiFetch` (or the underlying `fetch`) using `vi.mock` so tests don't make real HTTP calls. Provide fixture metric data arrays that include enough points for the regression to produce a non-zero slope.
- Coverage thresholds: add a `coverage` block to both `apps/api/vitest.config.ts` and `apps/dashboard/vitest.config.ts` — set `lines: 50, functions: 50` as the initial floor. This is deliberately low to avoid blocking CI immediately while establishing the habit.

## Tasks

1. Read `apps/dashboard/src/lib/use-disk-trend.ts` and `use-memory-trend.ts` fully.
2. Read `apps/dashboard/src/lib/api.test.ts` to understand the test setup.
3. Read `apps/dashboard/package.json` to confirm `@testing-library/react` is available.
4. Create `apps/dashboard/src/lib/use-disk-trend.test.ts`. Mock `apiFetch`. Test: hook returns null while loading, returns a numeric slope when data loads, returns null when fetch fails.
5. Create `apps/dashboard/src/lib/use-memory-trend.test.ts`. Same coverage as disk-trend.
6. Read `apps/api/vitest.config.ts` and `apps/dashboard/vitest.config.ts`. Add `coverage: { thresholds: { lines: 50, functions: 50 } }` to each.
7. Run `pnpm nx test dashboard --skip-nx-cache`. Fix any failures.

## Files involved

- (new) `apps/dashboard/src/lib/use-disk-trend.test.ts`
- (new) `apps/dashboard/src/lib/use-memory-trend.test.ts`
- `apps/api/vitest.config.ts` — add coverage thresholds
- `apps/dashboard/vitest.config.ts` — add coverage thresholds

## Acceptance criteria

- [x] `use-disk-trend.test.ts` covers: loading state, successful slope computation, fetch failure → null
- [x] `use-memory-trend.test.ts` covers the same cases
- [x] Both vitest configs have `coverage.thresholds` set to at least `lines: 50, functions: 50`
- [x] `pnpm nx test dashboard --skip-nx-cache` passes

## Completed

**Date:** 2026-06-28

### Summary
Created test suites for both trend hooks using `@testing-library/react`'s `renderHook`/`waitFor`. Both hooks are simple fetch-and-set-state patterns: `vi.mock('./api')` replaces `getDiskTrend`/`getMemoryTrend` with controllable mocks. Three cases each: loading state (pending promise → null), success (resolved value returned), failure (rejected → null via warn-logging catch). Added `@testing-library/react`, `@testing-library/user-event`, and `jsdom` to dashboard devDependencies. The dashboard vitest config was updated to use `environment: 'jsdom'` (required for React hook testing) and `coverage.thresholds: { lines: 50, functions: 50 }`. The API vitest config received the same coverage thresholds.

### Files changed
- (new) `apps/dashboard/src/lib/use-disk-trend.test.ts` — 3 tests for useDiskTrend
- (new) `apps/dashboard/src/lib/use-memory-trend.test.ts` — 3 tests for useMemoryTrend
- `apps/dashboard/vitest.config.ts` — added jsdom environment + coverage thresholds
- `apps/api/vitest.config.ts` — added coverage thresholds
- `apps/dashboard/package.json` — added `@testing-library/react`, `@testing-library/user-event`, `jsdom`

### Verification
- `pnpm nx test dashboard --skip-nx-cache`: 9/9 pass (3 files)

### Follow-ups
- `[defer]` Coverage thresholds are set at 50% — raise after more hooks and components get tests

## Out of scope

- Raising coverage thresholds above 50% (that's a future sprint after more tests are added)
- Testing the rendering of the slope value in components
- E2E tests
