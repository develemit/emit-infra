# ops.ts route tests: confirmation gating and session lifecycle
**Difficulty:** 3

## Goal
The ops-chat route (`apps/api/src/routes/ops.ts`) — the API's most complex untested surface — has route-level tests covering session lifecycle and, critically, that destructive tools always require confirmation before execution.

## Reason
2026-07-10 audit: 22 of 25 API routes are tested; `ops.ts` is the biggest gap. It wires a Claude agent loop to `executeTool`, which can trigger deploy/provision/destroy against production servers. The confirmation gate (`DESTRUCTIVE` set in tool-executor) is the only thing standing between a model response and a prod mutation — it deserves a regression test. This also locks in sprint 213's `service` sanitization at the route level.

## Context
- `apps/api/src/routes/ops.ts` — three routes: `GET /ops/session` (line 27, returns `{ sessionId }`), `DELETE /ops/session/:id` (line 29), `POST /ops/chat` (line 34, SSE streaming response driven by the Anthropic SDK).
- `apps/api/src/lib/tool-executor.ts` — `DESTRUCTIVE = new Set(['deploy', 'provision', 'destroy'])` (line 13); `executeTool` returns `{ requiresConfirmation: true, toolName, projectName }` for those without executing anything (lines 49-55).
- Session storage lives in a claude-session lib (TTL 24h, cap 100 — hardcoded constants). Find it via the imports in ops.ts.
- Test conventions: existing route tests (e.g. `apps/api/src/routes/rollback.test.ts`, `postgres.test.ts` from sprint 206) use Fastify `app.inject()`, `vi.mock` for lib modules. Gotcha from sprint 206: any test mocking `../lib/project-helpers.js` must export `SAFE_NAME_RE`, `SAFE_CONTAINER_RE`, and `SAFE_DOMAIN_RE`, or unrelated imports break.
- Mock the Anthropic client at module boundary (`vi.mock` the SDK or the wrapper lib ops.ts uses) — tests must never hit the real API. `POST /ops/chat` streams SSE; if full-stream assertion is awkward, test validation/error paths via inject and test the agent-loop logic at the lib level instead (same compromise sprint 206 made for `streamProcess` routes).
- Sessions are in-memory (`[hold]` backlog note) — tests can create/delete freely within one file, but remember module-scoped state survives between tests in the same file (sprint 206 TTL-cache lesson: use distinct session ids per test).

## Tasks
1. Read `ops.ts` and its session lib to map the exact seams (what to mock, what's pure).
2. Write `apps/api/src/routes/ops.test.ts`:
   - `GET /ops/session` returns a fresh UUID each call.
   - `DELETE /ops/session/:id` removes the session; deleting a nonexistent id doesn't 500.
   - `POST /ops/chat` with invalid body → 400; with missing/unknown session behaves per current contract.
   - Auth: routes reject unauthenticated requests when secret is set (reuse the `registerAuth` test pattern from `lib/auth-route.test.ts`).
3. Add/extend unit tests for the session lib: TTL expiry evicts sessions, cap (100) evicts oldest.
4. Extend `tool-executor.test.ts` (from sprint 213) if the confirmation-gating cases aren't already there: each of `deploy`/`provision`/`destroy` returns `requiresConfirmation: true` and spawns nothing.
5. Run `pnpm nx test api`, `pnpm nx typecheck api`, `pnpm nx lint api`.

## Files involved
- new file: `apps/api/src/routes/ops.test.ts` — route tests with mocked Anthropic client
- `apps/api/src/lib/` session lib (name TBD from ops.ts imports) — sibling test file if none exists
- `apps/api/src/lib/tool-executor.test.ts` — confirmation-gating cases (extends sprint 213's file)

## Acceptance criteria
- [x] Session create/delete lifecycle tested, including TTL and cap eviction at lib level
- [x] Destructive tools provably return `requiresConfirmation` without executing
- [x] `/ops/chat` validation and auth failure paths tested; no test ever calls the real Anthropic API
- [x] Tests pass, typecheck clean, lint clean

## Out of scope
- Full SSE stream integration test of the agent loop (note as `[defer]` if skipped)
- Refactoring ops.ts or the session lib (e.g. making TTL/cap configurable — separate backlog item)

## Completed

**Date:** 2026-07-11

### Summary
Wrote route tests for all three `ops.ts` endpoints (GET/DELETE session, POST chat) covering session lifecycle, auth rejection, invalid-body validation, agent SDK errors, and unknown-session handling. The Agent SDK is fully mocked so no test touches the real Anthropic API. Wrote lib-level tests for `claude-session.ts` covering store/retrieve/clear, TTL expiry (via fake timers), and cap eviction at 100-session boundary. Destructive-tool confirmation-gating was already proven in sprint 213's `tool-executor.test.ts` (all three criteria verified there).

### Files changed
- (new) `apps/api/src/routes/ops.test.ts` — 13 route tests: GET session (UUID, distinct per call), DELETE session (clears, no-500 on nonexistent), POST chat (400 invalid JSON, 200 agent reply, 503 SDK error, 200 unknown session), auth rejection for all three routes
- (new) `apps/api/src/lib/claude-session.test.ts` — 8 lib tests: store/retrieve/clear lifecycle, no-op clear, overwrite, TTL expiry before/after 24h, cap eviction at 101 sessions

### Verification
- `pnpm nx test api`: 266/266 pass (21 new tests across 2 new files)
- `pnpm nx typecheck api`: clean
- `pnpm nx lint api`: clean

### Follow-ups
- `[defer]` Full SSE stream integration test for the `confirmationFor` path (deploy/provision/destroy confirmation flow) — the SSE agent loop and hijacked-response streaming are out of scope per sprint spec
