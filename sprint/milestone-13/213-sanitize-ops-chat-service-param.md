# Sanitize ops-chat `service` param before SSH interpolation
**Difficulty:** 1

## Goal
The `service` value from Claude's ops-chat tool input is validated against `SAFE_CONTAINER_RE` before being interpolated into the remote `docker compose logs` command.

## Reason
2026-07-10 audit finding (the one verified security gap). `executeTool('get_logs')` passes `input['service']` — a value produced by the Claude agent loop in ops chat — straight into a shell command executed over SSH on a real production server. Every other interpolation path in the API validates with `SAFE_NAME_RE`/`SAFE_CONTAINER_RE` (sprints 179/184 closed this class); this one path was missed. A prompt-injected or malformed tool input could execute arbitrary commands on a prod server.

## Context
- `apps/api/src/lib/tool-executor.ts:23-30` — `collectLogs(host, service, keyName)` builds `docker compose logs --tail=200 ${service}` when `service` is truthy (line 25).
- `apps/api/src/lib/tool-executor.ts:104-110` — the `get_logs` case calls `collectLogs(host, (input['service'] as string) ?? '', ...)`.
- `apps/api/src/lib/project-helpers.ts:8` — `export const SAFE_CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/` — the validator to reuse.
- Convention elsewhere (e.g. routes): invalid value → return an error object, don't throw.
- This file is READ by the ops chat tool loop; keep the return shape `{ error: string }` consistent with the other error returns in the file (`{ error: 'project not found' }`, `{ error: 'unreachable' }`).

## Tasks
1. In the `get_logs` case of `executeTool`, validate `input['service']`: if it's a non-empty string that fails `SAFE_CONTAINER_RE`, return `{ error: 'invalid service name' }` before calling `collectLogs`. Empty/undefined stays allowed (means "all services").
2. Import `SAFE_CONTAINER_RE` from `./project-helpers.js`.
3. Add a unit test file `apps/api/src/lib/tool-executor.test.ts` (if one doesn't exist) covering:
   - `get_logs` with a malicious service (e.g. `web; rm -rf /` or `$(reboot)`) returns `{ error: 'invalid service name' }` and never invokes SSH (mock `./stream-process.js` and `./discover-projects.js`).
   - `get_logs` with a valid service (`web`) passes it through to the command.
   - Destructive tools (`deploy`) still return `requiresConfirmation` without executing anything.
4. Run `pnpm nx test api` and `pnpm nx typecheck api`.

## Files involved
- `apps/api/src/lib/tool-executor.ts` — add validation in `get_logs` case
- new file: `apps/api/src/lib/tool-executor.test.ts` — unit tests with mocked SSH/stream layers

## Acceptance criteria
- [x] Malicious `service` values are rejected with `{ error: 'invalid service name' }` and no SSH process is spawned
- [x] Valid service names and the empty/all-services case behave exactly as before
- [x] Tests pass, typecheck clean, lint clean

## Out of scope
- Refactoring `collectLogs` or other tool-executor cases
- ops.ts route tests (sprint 215 covers those)

## Completed

**Date:** 2026-07-10

### Summary
Added security validation to the `get_logs` tool in ops chat. The `service` parameter is now validated against `SAFE_CONTAINER_RE` before being interpolated into the remote SSH command, preventing shell injection attacks. The regex ensures service names only contain alphanumerics, underscores, hyphens, and dots — no shell metacharacters or quotes that could escape the single-quoted command context.

Empty/undefined service values remain allowed (means "all services"). Invalid inputs return `{ error: 'invalid service name' }` consistent with other error returns in the file.

### Files changed
- `apps/api/src/lib/tool-executor.ts` — Added SAFE_CONTAINER_RE import and validation check in get_logs case (lines 4, 108-111)
- `apps/api/src/lib/tool-executor.test.ts` — New file with 15 unit tests covering malicious/valid service names, destructive tools, and SSH integration

### Verification
- `pnpm nx test api`: 245 tests pass (including 15 new tool-executor tests)
- `pnpm nx typecheck api`: Clean
- Service validation regex: `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` prevents shell metacharacters

### Follow-ups
- `[defer]` ops.ts route integration tests (sprint 215 covers full route testing)
