# Route tests for history, reliability, cost, and response-times
**Difficulty:** 2

## Goal
`history.ts`, `reliability.ts`, `cost.ts`, and `response-times.ts` in `apps/api/src/routes/` each have inject-based test coverage: happy path, invalid project name, project-not-found, and upstream-failure per route group.

## Reason
2026-07-11 audit: these are the dashboard's most-hit read endpoints (charts, incident panels, cost cards) with zero test coverage — the largest remaining gap in an otherwise well-tested API (34 test files / 48 source). Same pattern as sprints 215/216, so this is mostly mechanical.

## Context
- Routes to cover:
  - `history.ts` — `:name/metrics` (59), `deploy-history` (85), `ci-history` (101), four more `app.get` at 117/134/151/192 (read the file to identify them — likely ci-log/deploy-log/disk-trend/memory-trend), `container-restarts` (233)
  - `reliability.ts` — `incidents` (67), `deploy-cadence` (111), `sla` (152)
  - `cost.ts` — single `app.get` (21); calls `getServerTypeMonthlyPrice` from `../lib/hetzner.js` (mock it), has a module-scoped `costCache` (31)
  - `response-times.ts` — single `app.get` (49); module-scoped `rtCache` (59)
- **Follow the established pattern** — see `apps/api/src/routes/project-status.test.ts` / `project-backups.test.ts` (sprint 216): Fastify instance + `app.register(routes)` + `app.inject`, `vi.mock('../lib/discover-projects.js')` and `vi.mock('@emit-infra/core')`.
- Known gotchas (from sprints 206/215/216):
  - If you mock `../lib/project-helpers.js`, the mock must export all three regexes: `SAFE_NAME_RE`, `SAFE_CONTAINER_RE`, `SAFE_DOMAIN_RE` — prefer not mocking it at all
  - Module-scoped TTL caches (`costCache`, `rtCache`, and any in history/reliability) survive between tests in a file — use distinct project names per test or `vi.resetModules()`
  - Mock `DiscoveredProject` fixtures must satisfy the zod **output** type: if the fixture includes `postgres`, it needs `version` and `backupRetainDays` too (this exact miss broke sprint 216's first pass)
- History/reliability routes read JSONL files — check what fs/lib helpers they use (`readJsonlTail` or similar in `lib/`) and mock at that seam rather than raw `fs`.
- Split test files if any would exceed ~300 lines (e.g. `history.test.ts` covering 8 routes may want two `describe`-focused files).

## Tasks
1. Read the four route files; identify the unnamed history routes and each route's lib seams.
2. Write `history.test.ts` (or split), `reliability.test.ts`, `cost.test.ts`, `response-times.test.ts`.
3. Per route group cover: 200 happy path with representative fixture data, 400 invalid name (fails SAFE_NAME_RE), 404 unknown project, upstream failure (SSH/file/pricing error) → error status.
4. For cost.ts: assert the cache path (second call same project doesn't re-hit the mocked pricing fn).
5. Run `pnpm nx test api`, `pnpm nx typecheck api`, `pnpm nx lint api`.

## Files involved
- `apps/api/src/routes/history.ts` — read-only
- `apps/api/src/routes/reliability.ts` — read-only
- `apps/api/src/routes/cost.ts` — read-only
- `apps/api/src/routes/response-times.ts` — read-only
- new files: sibling `.test.ts` for each

## Acceptance criteria
- [x] Every route in the four files has at least happy-path + one failure-path test
- [x] Cache behavior in cost/response-times pinned
- [x] No source changes (tests only, unless a genuine bug is found — then note it as a follow-up instead of fixing silently)
- [x] Tests pass, typecheck clean, lint clean

## Completed

**Date:** 2026-07-11

### Summary
Wrote comprehensive inject-based test coverage for the four highest-hit read endpoints in the API. All 8 routes now have happy-path and failure-path tests (including cache behavior verification for cost and response-times). Tests follow the established pattern from sprints 215/216: Fastify app registration, mocked `discoverProjects`/`sshExec`/`getServerTypeMonthlyPrice`, and file system mocking for JSONL reads. No source changes — tests only.

### Files changed
- (new) `apps/api/src/routes/history.test.ts` — 26 tests covering 8 routes
- (new) `apps/api/src/routes/reliability.test.ts` — 10 tests covering 3 routes
- (new) `apps/api/src/routes/cost.test.ts` — 7 tests covering 1 route with cache verification
- (new) `apps/api/src/routes/response-times.test.ts` — 7 tests covering 1 route with cache verification

### Verification
- `pnpm nx test api`: 293/293 pass (50 new tests added)
- `pnpm nx typecheck api`: clean
- `pnpm nx lint api`: clean

### Follow-ups
none

## Out of scope
- `push.ts` route tests (web-push needs different mocking; defer)
- Refactoring the route files themselves
