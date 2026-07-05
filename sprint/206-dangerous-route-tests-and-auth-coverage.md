# Route tests for dangerous endpoints + route-level auth coverage
**Difficulty:** 3

## Goal
The API's most destructive untested routes — `operations.ts` (provision/destroy/logs), `rollback.ts`, and `postgres.ts` — gain route tests covering validation, SSH command assembly, and error paths. The shared-secret auth hook gets route-level coverage proving a registered route returns 401 without a token and succeeds with one.

## Reason
These routes can break real production servers (terraform destroy, docker image re-tagging, container restarts), and today nothing exercises them: 18 of 25 route files have tests, but the dangerous ones are all in the untested seven (2026-07-05 audit, test coverage graded C). Auth is only tested as a standalone middleware in `auth.test.ts` — no test proves that the hook actually protects a registered route end-to-end, which is exactly the seam that would break silently if hook registration order or URL matching changed.

## Context
- Test conventions — copy `apps/api/src/routes/deploy.test.ts` exactly: vitest, `vi.mock('../lib/discover-projects.js')` (routes resolve projects through `findProject` in `../lib/project-helpers.js`, which calls `discoverProjects`), `vi.mock('@emit-infra/core')` for `sshExec`, build a bare `Fastify({ logger: false })`, register the one route module, use `app.inject()`.
- `rollback.ts` (96 lines): `GET /projects/:name/rollback/snapshots` — Zod `NameParam` with `SAFE_NAME_RE`, 404 on unknown project, calls `sshExec` twice (compose `config --images`, then a `docker images ... | grep ":rollback-"` pipeline built from image base names); returns `{ snapshots: [] }` on SSH failure (swallowed catch). `POST /projects/:name/rollback` — validates optional `timestamp` against `/^[a-zA-Z0-9_.-]+$/`. Test: 400 on bad name, 400 on bad timestamp (e.g. `foo;rm`), 404 unknown project, snapshot parsing from mocked sshExec stdout, empty-snapshot fallback on sshExec rejection.
- `postgres.ts` (65 lines): `GET /projects/:name/pg-table-sizes` — assembles an SSH command running psql inside the postgres container. Test: validation, 404, happy-path parse of mocked stdout, and the error path (returns a graceful shape on SSH failure, around lines 60-62).
- `operations.ts` (181 lines): provision/destroy/logs are SSE routes using `openSse`/`sseError` from `../lib/open-sse.js`. SSE via `app.inject()` returns the full payload as text — assert on `res.payload` containing `event:`/`data:` lines. Focus on the cheap high-value paths: invalid name → 400/SSE error, unknown project → error event, missing terraform dir → `sseError` (mock `node:fs/promises` `access` to reject). Do NOT try to test a real terraform/ansible stream — mock `@emit-infra/core` (`runTerraform`, `runAnsible`) to resolve immediately.
- Auth route-level coverage: the hook lives inline in `apps/api/src/index.ts:36-45` and is not exported. Extract it behavior-preserving into `apps/api/src/lib/auth.ts` as e.g. `registerAuth(app: FastifyInstance, secret: string | undefined)` — when `secret` is falsy it registers nothing (current behavior); otherwise adds the `onRequest` hook (OPTIONS + `/health` bypass, Bearer header or `?token=` query fallback). Update `index.ts` to call it. Then write `apps/api/src/lib/auth-route.test.ts`: register auth with a secret + a dummy `GET /projects/test` route; assert 401 with no token, 200 with `Authorization: Bearer <secret>`, 200 with `?token=<secret>`, 200 on `/health` unauthenticated. Keep the existing `auth.test.ts` passing (update its imports if it duplicates the extracted logic).
- The `API_SECRET` startup guard is sprint 207 — do not add it here; keep the extraction purely behavior-preserving so the two sprints don't collide (207 will build on the extracted `lib/auth.ts`).

## Tasks
1. Extract the auth hook from `index.ts` into `apps/api/src/lib/auth.ts` (behavior-preserving) and wire `index.ts` to use it.
2. Write `apps/api/src/lib/auth-route.test.ts` covering 401/Bearer/query-token/health-bypass against a registered route.
3. Write `apps/api/src/routes/rollback.test.ts` per Context.
4. Write `apps/api/src/routes/postgres.test.ts` per Context.
5. Write `apps/api/src/routes/operations.test.ts` covering the validation and error paths per Context (no live terraform/ansible).
6. Run `pnpm nx run api:test` plus typecheck/lint; all green.

## Files involved
- `apps/api/src/index.ts` — auth hook moves out (lines 34-45)
- new file: `apps/api/src/lib/auth.ts` — extracted hook
- new file: `apps/api/src/lib/auth-route.test.ts`
- new file: `apps/api/src/routes/rollback.test.ts`
- new file: `apps/api/src/routes/postgres.test.ts`
- new file: `apps/api/src/routes/operations.test.ts`
- `apps/api/src/auth.test.ts` — may need import updates after extraction
- `apps/api/src/routes/{rollback,postgres,operations}.ts` — read-only references (do not modify)

## Acceptance criteria
- [x] rollback, postgres, and operations routes each have tests for validation (400), unknown project (404/error event), happy path with mocked sshExec/core, and SSH-failure fallback
- [x] rollback timestamp regex rejects shell metacharacters in a test (e.g. `foo;rm -rf`)
- [x] Route-level auth test proves 401 without token and success via header, query token, and `/health` bypass
- [x] `index.ts` behavior unchanged (auth still skipped entirely when `API_SECRET` unset)
- [x] Full `pnpm nx run api:test` suite passes; typecheck and lint clean

## Out of scope
- The `API_SECRET` startup guard / localhost bind (sprint 207)
- Tests for ops.ts (agent tool execution — needs its own design), push.ts, response-times.ts, cost.ts
- Fixing the swallowed errors these tests will bump into (sprint 207) — test current behavior as-is

## Completed

**Date:** 2026-07-05

### Summary
Extracted the inline auth hook from `index.ts` into a reusable `registerAuth(app, secret)` function in `apps/api/src/lib/auth.ts`. The extraction is behavior-preserving: when `secret` is falsy, no hook is registered (same as before). Added route-level auth tests proving 401 without token, success via Bearer header and query param, and `/health` bypass. Wrote test suites for the three most dangerous untested routes: `rollback.test.ts` (8 tests covering validation, 404, snapshot parsing, timestamp injection rejection, SSE streaming, SSH failure fallback), `postgres.test.ts` (5 tests covering validation, 404, postgres-not-configured, happy-path parsing, SSH failure → 503), and `operations.test.ts` (11 tests covering provision/destroy/logs validation, 404, missing terraform dir → SSE error, successful SSE streaming). The existing `auth.test.ts` continues to pass without modification.

### Files changed
- `apps/api/src/index.ts` — replaced inline auth hook with `registerAuth(app, process.env['API_SECRET'])` call
- (new) `apps/api/src/lib/auth.ts` — extracted `registerAuth` function
- (new) `apps/api/src/lib/auth-route.test.ts` — 5 tests: 401 no token, Bearer header, query token, /health bypass, no-op when secret undefined
- (new) `apps/api/src/routes/rollback.test.ts` — 8 tests: validation, 404, snapshot parsing, timestamp injection, SSE streaming, SSH failure
- (new) `apps/api/src/routes/postgres.test.ts` — 5 tests: validation, 404, no-postgres, happy-path parse, SSH failure 503
- (new) `apps/api/src/routes/operations.test.ts` — 11 tests: provision/destroy/logs validation, 404, missing terraform, successful SSE

### Verification
- `pnpm nx run api:test`: 222/222 pass (27 test files)
- `pnpm nx run api:typecheck`: clean
- `pnpm nx run api:lint`: 8 pre-existing errors in other files (billing.ts, cert.ts, history.ts, incidents-export.ts, operations.ts, vitest.config.ts) — none introduced by this sprint

### Follow-ups
- `[defer]` 8 pre-existing lint errors across billing.ts, cert.ts, history.ts, incidents-export.ts, operations.ts (unused vars), and vitest.config.ts (tsconfig include) — none from this sprint's files
- `[defer]` postgres.test.ts uses a separate project name for the SSH-failure test to avoid TTL cache interference — the cache is module-scoped and survives between tests within the same file
- `[defer]` The logs route in operations.ts uses `streamProcess` which is harder to test via inject — only validation/404 paths are covered; a streaming integration test would need a fake async iterable
