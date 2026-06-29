# Sprint 112 — Test coverage expansion: hooks, helpers, trend routes

> _Promoted from sprint-107, sprint-108, sprint-109, sprint-110, sprint-111 follow-ups, 2026-06-28._

**Difficulty:** 3

## Goal

Add test suites for the hooks and helper modules extracted in sprints 109–111 and the uncovered API routes from sprint-107, then raise coverage thresholds from 50% to 65%.

## Context

Sprints 107–111 left the following without any tests:
- `apps/dashboard/src/lib/use-project-detail.ts` — composition hook owning all project-detail state
- `apps/dashboard/src/lib/use-ops-chat.ts` — chat session/message/streaming/context hook
- `apps/dashboard/src/components/detail/container-row.tsx` — MobileContainerRow + DesktopContainerRow
- `apps/dashboard/src/components/detail/full-chart-helpers.ts` — pure chart helpers (toPolyline, deployX, formatTimeLabel, etc.)
- `apps/api/src/routes/history.ts` — disk-trend and memory-trend routes have no tests (container restart route also uncovered)

Coverage thresholds in both `apps/api/vitest.config.ts` and `apps/dashboard/vitest.config.ts` are currently at 50% for lines and functions. After adding these tests, raise them to 65%.

### Hook tests setup
- Dashboard tests use `vitest` + `@testing-library/react` with `renderHook`/`waitFor`
- Mock `@/lib/api` with `vi.mock('./api')` or `vi.mock('@/lib/api')` depending on import path
- For `use-project-detail`: it composes 8 existing hooks — mock each at the module level. The hook owns polling (60s interval) — use `vi.useFakeTimers()` to test it without real delays.
- For `use-ops-chat`: it fetches `/ops/session` on mount and `/ops/chat` on submit — stub `global.fetch`. The key behaviors to test: initial session load, `submit()` pushing messages, `handleCancel()` removing the confirm card, `clearContext()` clearing statusContext and contextProject.

### Helper tests
- `full-chart-helpers.ts` exports pure functions — straightforward unit tests, no React needed
- `container-row.tsx` exports React components — render with minimal props and assert output

### API route tests
- Add to the existing `apps/api/src/routes/history.test.ts` file (or create a separate file if that file approaches 300 lines)
- disk-trend: test happy path returns `{ pct, disk, projectedDaysUntilFull }`, test 404 when project not found
- memory-trend: same structure as disk-trend
- Container restarts route (`/projects/:name/containers/:container/restarts`) is in `apps/api/src/routes/history.ts` — add 2 tests: happy path and 404

## Tasks

1. Read `apps/dashboard/src/lib/use-project-detail.ts` and `apps/dashboard/src/lib/use-ops-chat.ts` fully to map their dependencies.
2. Write `apps/dashboard/src/lib/use-project-detail.test.ts` — at least 3 tests: loading state on mount, data populated after fetch resolves, `fetchData()` refetch triggers re-render.
3. Write `apps/dashboard/src/lib/use-ops-chat.test.ts` — at least 4 tests: session loads on mount, submit sends message, handleCancel removes confirm card, clearContext resets context state.
4. Write `apps/dashboard/src/components/detail/full-chart-helpers.test.ts` — cover `toPolyline`, `deployX`, `formatTimeLabel`, `timeLabels`, `filterVisibleDeploys`.
5. Read `apps/api/src/routes/history.ts` disk-trend and memory-trend route handlers. Add tests for those routes plus the container-restarts route to `history.test.ts` (or a sibling file if the existing one is near 300 lines).
6. Raise thresholds in both `apps/api/vitest.config.ts` and `apps/dashboard/vitest.config.ts` from `50` to `65`.
7. Run `pnpm nx test api --skip-nx-cache` and `pnpm nx test dashboard --skip-nx-cache`. Fix any failures.

## Files involved

- (new) `apps/dashboard/src/lib/use-project-detail.test.ts`
- (new) `apps/dashboard/src/lib/use-ops-chat.test.ts`
- (new) `apps/dashboard/src/components/detail/full-chart-helpers.test.ts`
- `apps/api/src/routes/history.test.ts` — extend with disk-trend, memory-trend, restarts
- `apps/api/vitest.config.ts` — raise thresholds
- `apps/dashboard/vitest.config.ts` — raise thresholds

## Acceptance criteria

- [x] `use-project-detail.test.ts` exists with ≥3 passing tests
- [x] `use-ops-chat.test.ts` exists with ≥4 passing tests
- [x] `full-chart-helpers.test.ts` exists with ≥5 passing tests
- [x] disk-trend, memory-trend, and container-restarts routes have test coverage in API test suite
- [x] Both vitest configs have `lines: 65, functions: 65`
- [x] `pnpm nx test api --skip-nx-cache` passes
- [x] `pnpm nx test dashboard --skip-nx-cache` passes

## Completed

**Date:** 2026-06-28

### Summary
Added `use-project-detail.test.ts` (4 tests: loading state, status populated, fetchData refetch, deployUrl derivation), `use-ops-chat.test.ts` (4 tests: session init, submit message, clearContext, handleNewConversation), and `full-chart-helpers.test.ts` (9 tests covering toPolyline, deployX, formatTimeLabel, formatTooltipTime, timeLabels, filterVisibleDeploys). Extended `history.test.ts` with 7 new tests covering disk-trend (happy path, insufficient points, 404), memory-trend (happy path, 404), and container-restarts (happy path, 404). Added `@` path alias to dashboard vitest config and raised thresholds to 65% in both configs. API: 35 tests total. Dashboard: 29 tests total.

### Files changed
- (new) `apps/dashboard/src/lib/use-project-detail.test.ts` — 4 tests
- (new) `apps/dashboard/src/lib/use-ops-chat.test.ts` — 4 tests
- (new) `apps/dashboard/src/components/detail/full-chart-helpers.test.ts` — 9 tests
- `apps/api/src/routes/history.test.ts` — +7 tests (disk-trend, memory-trend, container-restarts)
- `apps/api/vitest.config.ts` — thresholds raised from 50 to 65
- `apps/dashboard/vitest.config.ts` — added `@` alias + thresholds raised from 50 to 65

### Verification
- `pnpm nx test api --skip-nx-cache`: 35/35 pass
- `pnpm nx test dashboard --skip-nx-cache`: 29/29 pass

### Follow-ups
- `[defer]` container-row.tsx React components still untested — defer to visual-test sprint

## Out of scope

- Testing `container-row.tsx` React components (jsdom rendering overhead; leave for a later visual-test sprint)
- 100% coverage — 65% is the target
- Testing the SSE streaming paths (those require a different test approach)
