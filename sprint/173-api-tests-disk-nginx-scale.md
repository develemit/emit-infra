# API Route Tests: Disk Breakdown, Nginx Endpoints, Scale Advice
**Difficulty:** 3

## Goal
Add test coverage for the `disk-breakdown`, `nginx-endpoints`, and `scale-advice` API routes.

## Reason
These three routes have zero test coverage. Disk-breakdown runs `du -sh` over SSH; nginx-endpoints runs a two-pass awk command; scale-advice reads 12 metric points and checks a 6-of-12 threshold rule. All have non-trivial branching (unavailable server, missing data, threshold edge cases) that should be verified to prevent silent regressions.

## Context
- Read existing tests for patterns: `apps/api/src/routes/history.test.ts`, `projects.test.ts`, `backup.test.ts`. They show how to: build a Fastify app with routes registered, mock `sshExec` from `@emit-infra/core` with `vi.mock`, mock `fs/promises` for file reads, and use `app.inject()` for HTTP requests.
- `apps/api/src/routes/disk.ts` — `GET /projects/:name/disk-breakdown`: runs `du -sh` via sshExec, parses output into categories, caches 300s. Test: 404 on unknown project, 503 when sshExec throws, happy path with mock `du` output.
- `apps/api/src/routes/nginx-endpoints.ts` — `GET /projects/:name/nginx-endpoints`: two-pass awk, returns `{ endpoints: [...] }`. Test: 404 on unknown project, SSH failure → `{ endpoints: [] }`, happy path with mock awk stdout matching the `---END1---` delimiter format.
- `apps/api/src/routes/scale-advice.ts` — reads last 12 metric points from JSONL, checks 6-of-12 consecutive ≥80% for disk or memory. Test: no metrics file → null/no advice, 6 consecutive points at ≥80% → advice returned, 5 consecutive → no advice.

## Tasks
1. Read `disk.ts`, `nginx-endpoints.ts`, and `scale-advice.ts` to understand dependencies and response shapes.
2. Create `disk.test.ts`: mock `findProject`, mock `sshExec`. Write tests for 404, 503, and happy path with a representative `du -sh` output string.
3. Create `nginx-endpoints.test.ts`: mock `findProject`, mock `sshExec`. Write tests for 404, SSH failure → empty endpoints, happy path with mock two-pass awk output using the `---END1---` delimiter.
4. Create `scale-advice.test.ts`: mock `findProject`, mock `readJsonl` (or `fs/promises`). Write tests for: no metrics → no advice, exactly 6 consecutive ≥80% hits → advice present, only 5 consecutive → no advice.
5. Run `npx nx test api` to confirm all tests pass.

## Files involved
- new file: `apps/api/src/routes/disk.test.ts`
- new file: `apps/api/src/routes/nginx-endpoints.test.ts`
- new file: `apps/api/src/routes/scale-advice.test.ts`

## Acceptance criteria
- [x] Each test file has ≥3 test cases (not-found, error/unavailable, happy path)
- [x] Scale advice test specifically verifies the 6-of-12 threshold boundary (5 → no advice, 6 → advice)
- [x] Nginx endpoints test verifies the `---END1---` delimiter parsing via mock stdout
- [x] `npx nx test api` passes
- [x] Typecheck passes

## Out of scope
- Integration tests against a real server
- Testing TTL cache behavior (unit-test the logic, not the cache layer)
- Testing Hetzner API calls (those belong in billing tests, sprint 174)

## Completed

**Date:** 2026-07-02

### Summary
Created three new test files covering `disk-breakdown`, `nginx-endpoints`, and `scale-advice`. All follow the established pattern: `vi.mock` for `discoverProjects` (controls `findProject`), `createTtlCache` (disables caching), and `sshExec` or `readJsonl` as needed. Tests use `app.inject()` via a fresh Fastify instance per test.

The scale-advice tests specifically verify the 6-of-12 consecutive threshold: 12 points with the last 5 at ≥80% produce no advice (streak resets to 0 on any sub-threshold point), while the last 6 at ≥80% triggers advice. Both disk and memory resources are tested. The nginx-endpoints test constructs a realistic two-pass awk mock output with the `---END1---` delimiter and verifies endpoint count, request counts, error counts, and errorRate.

### Files changed
- (new) `apps/api/src/routes/disk.test.ts` — 4 tests: 404, 503, happy path, empty output
- (new) `apps/api/src/routes/nginx-endpoints.test.ts` — 4 tests: 404, 503, no-delimiter, happy path with delimiter parsing
- (new) `apps/api/src/routes/scale-advice.test.ts` — 6 tests: 404, no points, 5-streak disk, 6-streak disk, 5-streak mem, 6-streak mem

### Verification
- `npx nx test api`: 68/68 pass (7 test files)
- `npx nx run-many -t typecheck`: clean (all 5 packages pass)

### Follow-ups
- none
