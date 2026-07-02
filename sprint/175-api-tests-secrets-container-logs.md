# API Route Tests: Secrets Sync + Container Logs
**Difficulty:** 3

## Goal
Add test coverage for the `secrets-sync` and `container-logs` route files.

## Reason
Secrets-sync has complex drift-detection logic (env key comparison, missing vs extra keys) that is high-risk to regress — a bug here means users see false "no drift" when keys are actually mismatched. Container-logs uses SSE streaming, a different pattern from the JSON routes tested in sprints 173–174, worth verifying that params are validated and headers are correct.

## Context
- `apps/api/src/routes/secrets-sync.ts` — `GET /projects/:name/secrets-sync` reads a local `.env` file and compares it to the remote env via SSH, reporting drift (missing keys, extra remote keys, value mismatches). The drift logic is the core thing to test. Mock: `fs/promises.readFile` for local env, `sshExec` for remote env output.
- `apps/api/src/routes/container-logs.ts` — `GET /projects/:name/containers/:container/logs` opens an SSE stream. For unit testing, use Fastify `inject` and check: (a) invalid container name → 400, (b) unknown project → 404, (c) valid request sets `Content-Type: text/event-stream` and `Cache-Control: no-cache`. Full stream content doesn't need to be verified in a unit test.
- Read both route files before writing tests to understand the exact shapes and validation rules.
- Follow the existing test patterns in `history.test.ts` and `backup.test.ts` for file mocking and Fastify app setup.

## Tasks
1. Read `secrets-sync.ts` and `container-logs.ts` to understand all routes and dependencies.
2. Create `secrets-sync.test.ts`:
   - Mock `fs/promises.readFile` for local `.env`
   - Mock `sshExec` for remote env output
   - Test: in-sync case (no drift), missing local key present remotely (drift), extra remote key not in local (drift), SSH failure → 503
3. Create `container-logs.test.ts`:
   - Test: container name with shell metacharacters → 400
   - Test: unknown project → 404
   - Test: valid project + valid container name → response has `Content-Type: text/event-stream`
4. Run `npx nx test api`.

## Files involved
- new file: `apps/api/src/routes/secrets-sync.test.ts`
- new file: `apps/api/src/routes/container-logs.test.ts`

## Acceptance criteria
- [x] Secrets test covers in-sync case (0 drift items) and at least one drift case
- [x] Secrets test covers SSH failure → 503
- [x] Container logs test verifies invalid container name returns 400
- [x] Container logs test verifies valid request returns `text/event-stream` Content-Type
- [x] `npx nx test api` passes
- [x] Typecheck passes

## Out of scope
- Testing actual SSE event content (header/status check is sufficient for unit tests)
- Testing secrets *apply/sync* action (that's sprint 176)
- Auth middleware testing

## Completed

**Date:** 2026-07-02

### Summary
Added test coverage for secrets drift detection and container logs SSE route. The sprint's description pointed to `secrets-sync.ts` for drift logic, but the actual drift detection route (`GET /projects/:name/secrets-drift`) lives in `secrets.ts` — so the test file is named `secrets.test.ts` accordingly. The drift tests cover the full matrix: unconfigured project (no `requiredEnvKeys`), SSH failure → 503, in-sync (all keys present), drift (missing keys), and extra server-side keys. The container-logs test uses a `streamProcess` mock that immediately yields a `done` event so `inject()` resolves synchronously while still verifying the `text/event-stream` header set by `openSse`.

### Files changed
- (new) `apps/api/src/routes/secrets.test.ts` — 6 tests for `GET /projects/:name/secrets-drift`: 404, unconfigured, 503, ok, drift, extra-keys
- (new) `apps/api/src/routes/container-logs.test.ts` — 3 tests for `GET /projects/:name/containers/:container/logs`: 400, 404, SSE header

### Verification
- `npx nx test api`: 106/106 pass
- typecheck: clean across all 5 packages

### Follow-ups
- `[defer]` The sprint planned `secrets-sync.test.ts` but drift logic is in `secrets.ts`; the planning doc conflated the two files. Sprint 176 (secrets sync flow) may want to add SSE-based tests for `secrets-sync.ts` post-implementation.
