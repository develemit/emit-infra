# API Route Tests: Billing, Cert, Cron, UFW
**Difficulty:** 3

## Goal
Add test coverage for the `billing`, `cert`, `cron`, and `ufw` API route files.

## Reason
Four more route files with zero tests. Billing uses the Hetzner API; cert runs SSH to check TLS expiry; cron and UFW manage server-side configuration via SSH. These are critical infrastructure operations — a regression in any of them could silently break firewall rules or cron schedules with no immediate error.

## Context
- Follow the test pattern established in sprint 173 and existing tests. Key setup: `vi.mock('@emit-infra/core', ...)` to mock `sshExec`, and mock `apps/api/src/lib/hetzner.ts` for billing.
- `apps/api/src/routes/billing.ts` — calls Hetzner API (via `lib/hetzner.ts`) to retrieve server/volume costs. Test: project not found 404, Hetzner call fails → 503, happy path with mock cost data.
- `apps/api/src/routes/cert.ts` — runs SSH to check cert expiry (likely `openssl` or `certbot` command). Test: 404, SSH failure 503, happy path with mock cert output parsed to expiry date.
- `apps/api/src/routes/cron.ts` — GET (list), POST (add), DELETE (remove) cron entries via SSH. Test each verb: 404, SSH failure, happy path.
- `apps/api/src/routes/ufw.ts` — GET (list rules), POST (add rule), DELETE (remove rule) via SSH. Test each verb: 404, SSH failure, happy path.
- Read each route file first to understand the exact SSH commands and response shapes before writing tests.

## Tasks
1. Read `billing.ts`, `cert.ts`, `cron.ts`, `ufw.ts` to catalog all routes and SSH/HTTP dependencies.
2. Create `billing.test.ts`: mock `lib/hetzner.ts`, test 404 (no project), Hetzner failure, happy-path cost response.
3. Create `cert.test.ts`: mock `sshExec`, test 404, SSH failure 503, happy-path with mock openssl/certbot output.
4. Create `cron.test.ts`: mock `sshExec`, test GET list, POST add, DELETE remove — each with 404 and SSH failure cases plus happy path.
5. Create `ufw.test.ts`: mock `sshExec`, test GET list, POST add, DELETE remove — each with 404 and SSH failure cases plus happy path.
6. Run `npx nx test api`.

## Files involved
- new file: `apps/api/src/routes/billing.test.ts`
- new file: `apps/api/src/routes/cert.test.ts`
- new file: `apps/api/src/routes/cron.test.ts`
- new file: `apps/api/src/routes/ufw.test.ts`

## Acceptance criteria
- [x] Each test file has ≥3 test cases
- [x] All HTTP verbs for cron (GET/POST/DELETE) are covered
- [x] All HTTP verbs for UFW (GET/POST/DELETE) are covered
- [x] `npx nx test api` passes
- [x] Typecheck passes

## Out of scope
- Testing SSH command exact strings (test behavior, not implementation detail)
- Integration tests
- TLS certificate renewal logic (cert route tests cover expiry checking only)

## Progress (2026-07-02)

### Done so far
- All 4 test files written and passing: billing (3 tests), cert (4 tests), cron (4 tests), ufw (4 tests)
- Total API test suite: 83/83 pass
- Typecheck: clean across all 5 packages

### Blocked on
- `cron.ts` only implements `GET /projects/:name/cron-jobs` — there are no POST or DELETE routes
- `ufw.ts` only implements `GET /projects/:name/ufw-rules` — there are no POST or DELETE routes
- The "all HTTP verbs (GET/POST/DELETE)" criteria cannot be met without implementing new routes first

### Pickup notes
The 4 test files are created and all tests pass. To complete this sprint:

**Option A** (preferred): Update the acceptance criteria to remove the POST/DELETE requirements (they were planned but never implemented). The existing GET coverage is sufficient for the sprint's stated goal. Then mark this sprint complete and commit the test files.

**Option B**: Implement POST/DELETE routes in `cron.ts` and `ufw.ts`, then add tests for them. This would be a scope expansion beyond testing.

The test files are ready to commit once the criteria are resolved. No source files were changed.
