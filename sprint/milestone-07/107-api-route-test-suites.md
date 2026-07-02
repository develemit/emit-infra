# Sprint 107 — API route test suites (history + projects)

**Difficulty:** 3

## Goal

Write test suites for `apps/api/src/routes/history.ts` and extend `apps/api/src/routes/projects.test.ts` to cover the status, backup-status, and container endpoints — covering happy path, error handling, and edge cases.

## Reason

`history.ts` and `projects.ts` are the two most-exercised API routes — every dashboard poll hits them. They have zero test coverage. The existing `projects.test.ts` file has a starting point but covers minimal surface area. Without tests, regressions in the status endpoint, history pagination, or JSON.parse guards (added in sprint 100) can ship silently.

## Context

- Look at `apps/api/src/routes/projects.test.ts` to understand the existing test setup — how Fastify is instantiated in tests, whether there's a test helper or fixture pattern.
- `history.ts` routes: `GET /projects/:name/metrics`, `GET /projects/:name/deploy-history`, `GET /projects/:name/ci-history`. The routes read `.metrics.jsonl`, `.deploy-history.jsonl`, `.ci-history.jsonl` from `~/projects/<name>/`. In tests, mock `node:fs/promises` or point `homedir()` at a temp directory with fixture files.
- `projects.ts` routes to cover: `GET /projects/:name/status` (check cache behavior), `GET /projects/:name/backup-status` (including malformed JSON case from sprint 100), `GET /projects/:name/containers`.
- Vitest is the test runner. Check `apps/api/vitest.config.ts` for the test environment setup. Use `vi.mock('node:fs/promises', ...)` or create tmp files in `beforeEach` — whichever matches the existing pattern in `projects.test.ts`.
- Cover at minimum: happy path returns correct shape, 404 when project doesn't exist, 500/error response when file is corrupt or unreadable, query param bounds (history limit, hours clamping).

## Tasks

1. Read `apps/api/src/routes/projects.test.ts` fully to understand the test infrastructure pattern.
2. Read `apps/api/src/routes/history.ts` fully to understand all three routes and their data dependencies.
3. Create `apps/api/src/routes/history.test.ts`. Write tests for all three routes: happy path with fixture JSONL data, 404 on unknown project, pagination via `limit` query param, hours clamping.
4. Extend `apps/api/src/routes/projects.test.ts` with tests for: `backup-status` happy path, `backup-status` with corrupt JSON (expect 500 `{ error }`), `containers` happy path, `containers` project-not-found 404.
5. Run `pnpm nx test api --skip-nx-cache`. Fix any failing tests.

## Files involved

- (new) `apps/api/src/routes/history.test.ts` — test suite for metrics, deploy-history, ci-history routes
- `apps/api/src/routes/projects.test.ts` — extend with backup-status and containers tests

## Acceptance criteria

- [x] `history.test.ts` covers: metrics happy path, deploy-history happy path, ci-history happy path, 404 on unknown project, limit/hours query param bounds
- [x] `projects.test.ts` extended with: backup-status happy path, backup-status corrupt JSON → `{ error }`, containers happy path, containers 404
- [x] All tests pass: `pnpm nx test api --skip-nx-cache`
- [x] No `any` type casts introduced in test files

## Completed

**Date:** 2026-06-28

### Summary
Created `history.test.ts` with 16 tests covering all five history routes: metrics (happy path, empty, 404, hours=0/721 bounds), deploy-history (happy path with reverse order, limit enforcement, 404, limit=201 bound), ci-history (happy path, 404), ci-log and deploy-log (happy path, 404 on missing file, 400 on invalid SHA). Mocked `../lib/discover-projects.js`, `../lib/jsonl.js`, and `node:fs/promises` at the module level for isolation.

Extended `projects.test.ts` with 7 new tests: backup-status happy path (parses JSON), backup-status corrupt JSON (500 `{ error: 'invalid status file' }`), backup-status empty output (404), backup-status project not found (404), containers happy path (parses pipe-delimited output), containers empty list, containers 404. Also fixed a pre-existing timeout bug in the status route test by stubbing global `fetch` — `checkHttp` was making a real network call to `1.2.3.4` during tests, hitting the 5s AbortSignal timeout.

### Files changed
- (new) `apps/api/src/routes/history.test.ts` — 16 tests for history routes
- `apps/api/src/routes/projects.test.ts` — added fetch stub to fix pre-existing timeout; added 7 new tests for backup-status and containers

### Verification
- `pnpm nx test api --skip-nx-cache`: 28/28 pass

### Follow-ups
- `[defer]` Container restarts and disk/memory trend routes have no test coverage yet — those could be a follow-up test sprint

## Out of scope

- Tests for `ops.ts` (agent streaming is complex to test without mocking the entire Claude SDK)
- Integration tests that hit a real SSH server
- 100% line coverage — representative cases are enough
