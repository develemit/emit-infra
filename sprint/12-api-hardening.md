# Sprint 12 — API hardening

> _Promoted from sprint-01 follow-up, sprint-02 follow-ups, 2026-06-03._

## Goal
Harden the API before production use: validate required directories exist before opening SSE streams, add a 15-minute timeout to operations that would otherwise hang indefinitely, and return HTTP 503 (not 200) when a project's server is unreachable.

## Context
- Builds on sprints 01 and 02.
- `apps/api/src/routes/operations.ts` — POST deploy/provision/destroy open SSE and immediately run ansible/terraform without first checking that `inventory.ini` / `terraform/` directories exist. A missing directory causes a cryptic ansible/terraform failure; it should fail fast with a clear SSE error event.
- `apps/api/src/routes/projects.ts` — GET /projects/:name/status and /projects/:name/containers return HTTP 200 with `{ error: "unreachable" }` when SSH fails. The dashboard UI interprets 200 as success and cannot distinguish "host down" from "no data yet" without parsing the body. HTTP 503 is the correct status.
- Operations have no timeout. A hung ansible-playbook or terraform apply holds the SSE connection open until the client disconnects.
- Relevant files: `apps/api/src/routes/operations.ts`, `apps/api/src/routes/projects.ts`.

## Tasks

1. **Validate directories before opening SSE** in `apps/api/src/routes/operations.ts`:
   - For `deploy`: check that `path.join(homedir(), 'projects', name, 'inventory.ini')` exists. If not, set up SSE headers, emit `{ type: 'error', message: 'inventory.ini not found at ~/projects/<name>/inventory.ini' }` then `{ type: 'done', exitCode: 1 }`, end the stream, and return.
   - For `provision` and `destroy`: check that `path.join(homedir(), 'projects', name, 'terraform')` is a directory. If not, emit an SSE error event and return.

2. **Add a 15-minute operation timeout**:
   - Wrap the ansible/terraform execution in a `Promise.race` with a 15-minute timeout promise.
   - On timeout: emit `{ type: 'error', message: 'Operation timed out after 15 minutes' }` then `{ type: 'done', exitCode: 1 }`, end the stream.

3. **Fix HTTP status for unreachable servers** in `apps/api/src/routes/projects.ts`:
   - In the `GET /projects/:name/status` handler, when the SSH call throws, return `reply.status(503).send({ error: 'unreachable' })` instead of `reply.send({ error: 'unreachable' })`.
   - Same for `GET /projects/:name/containers`.

## Files involved
- `apps/api/src/routes/operations.ts` — add path validation + timeout
- `apps/api/src/routes/projects.ts` — fix HTTP status for unreachable

## Completed

**Date:** 2026-06-03

### Summary
Added three defensive layers to the API. Path validation: deploy now checks `~/projects/<name>/inventory.ini` exists before opening the SSE stream; provision and destroy check `~/projects/<name>/terraform/` exists — if either is missing, the handler hijacks, opens the SSE stream, emits `{ type: 'error', message: '...' }` + `{ type: 'done', exitCode: 1 }`, and returns immediately without attempting the operation. Timeout: all three operations are wrapped in `Promise.race` with a 15-minute timer; on timeout the error event is emitted before the done event. HTTP status fix: both `/projects/:name/status` and `/projects/:name/containers` now return HTTP 503 (not 200) when the SSH call throws, so clients can distinguish "host down" from valid responses.

Extracted two tiny shared helpers (`openSse`, `sseError`) to eliminate the repeated header-writing pattern across the three operation handlers.

### Files changed
- `apps/api/src/routes/operations.ts` — added `access` import, `OPERATION_TIMEOUT_MS`, `operationTimeout`, `sseError`, `openSse` helpers; added path checks + timeout to deploy/provision/destroy
- `apps/api/src/routes/projects.ts` — changed both `return { error: 'unreachable' }` to `return reply.status(503).send({ error: 'unreachable' })`

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Code inspection: `access(inventory)` check fires before SSE stream for deploy; `access(terraformDir)` fires for provision/destroy
- Code inspection: `Promise.race([operation(), operationTimeout()])` wraps all three handlers
- Code inspection: both status/containers catch blocks use `reply.status(503).send()`

### Follow-ups
none

## Acceptance criteria
- [x] POST deploy to a project with no inventory.ini returns SSE with `{ type: 'error' }` + `{ type: 'done', exitCode: 1 }` immediately (no ansible attempt)
- [x] POST provision to a project with no terraform/ directory returns SSE error immediately
- [x] GET /projects/:name/status returns HTTP 503 when the server is unreachable
- [x] GET /projects/:name/containers returns HTTP 503 when unreachable
- [x] `pnpm typecheck` and `pnpm lint` pass
