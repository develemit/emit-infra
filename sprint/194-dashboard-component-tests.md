# Dashboard component tests, batch 1: logic-heavy detail panels
**Difficulty:** 3

## Goal
The five most logic-dense dashboard components have meaningful unit tests: health-card, incident-panel, backup-panel, sla-panel, and summary-card.

## Reason
API routes now have solid coverage (13 test files), but the dashboard has exactly one component test (`container-row.test.tsx`) for ~63 components — flagged by the 2026-07-02 scan. Recent sprints keep touching these panels (180/181 modified backup-panel and container-row); tests stop regressions from the steady churn. Batch 1 targets components with real logic (thresholds, state machines, formatting), not thin presentational wrappers.

## Context
- Test setup already exists: see `apps/dashboard/src/components/detail/container-row.test.tsx` for the working pattern (vitest + whatever rendering approach it uses — read it first and copy its conventions exactly: environment, imports, mock style). Also see `full-chart-helpers.test.ts` for the pure-logic test style.
- Priority targets and what to test:
  - `health-card.tsx` — status/uptime rendering, scale-advice nudge visibility, threshold-driven styling.
  - `incident-panel.tsx` — empty state, incident list rendering, duration/MTTR formatting. (If sprint 189 has landed, include annotation display; if not, test current behavior.)
  - `backup-panel.tsx` — `fmtElapsed` formatting (45s vs 1m 30s), stale-backup warning threshold logic (older than `backupAgeHours`), button state machine (idle → running → complete/failed/timeout), delete confirm two-step. Timers: use `vi.useFakeTimers()`.
  - `sla-panel.tsx` — uptime percentage rendering and threshold coloring.
  - `summary-card.tsx` — stats rendering, `hidden` prop behavior, href wiring.
- Where a component's logic is hard to test through rendering (e.g. inline helpers like `fmtElapsed`, `ageLabel`, threshold math), prefer extracting the pure function to a colocated helper module IF the extraction is trivial and keeps behavior identical — this matches the repo's "pure logic → helper modules" convention. Don't force extractions that require prop-drilling changes.
- Mock the `@/lib/api` calls (`getBackupStatus`, etc.) with `vi.mock` — panels must not hit the network. Check how `container-row.test.tsx` mocks `restartContainer`/toast.
- Coverage thresholds exist in the vitest config (65%) — don't chase the number; write assertive tests for the behaviors above.

## Tasks
1. Read `container-row.test.tsx` and the dashboard vitest config to lock in conventions.
2. Write tests for the five components (one `.test.tsx` each, colocated), extracting trivially-pure helpers where it makes testing cleaner.
3. Run `npx nx run dashboard:test` until green; typecheck.

## Files involved
- new files: `health-card.test.tsx`, `incident-panel.test.tsx`, `backup-panel.test.tsx`, `sla-panel.test.tsx`, `summary-card.test.tsx` in `apps/dashboard/src/components/detail/`
- possibly small helper extractions colocated with their components

## Acceptance criteria
- [ ] All five components have tests covering the behaviors listed in Context
- [ ] Backup-panel state machine (running/elapsed/timeout) tested with fake timers
- [ ] No test makes a real network call
- [ ] `npx nx run dashboard:test` and typecheck clean

## Out of scope
- Remaining ~55 components (future batches)
- E2E/browser tests
