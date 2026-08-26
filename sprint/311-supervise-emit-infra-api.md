# Supervise the emit-infra API and give it the missing `uncaughtException` handler
**Difficulty:** 3

## Goal
`apps/api` runs under sprint 310's supervisor, so a crashed server comes back
on its own; and an uncaught exception produces a rich log line plus a clean
non-zero exit instead of a silent disappearance.

## Reason
On 2026-08-23 the API on port 7001 was down ~14 hours. It went unnoticed
because the develemit-hq dashboard — which is where deployment insights are
read — stayed up and simply had nothing to show. From the outside it looked
like the dashboard was broken.

Two independent gaps caused it, and this sprint closes both:

1. **No `uncaughtException` handler.** `apps/api/src/index.ts:74` registers
   `unhandledRejection` (logs via `app.log.error`, does not exit — correct),
   but there is no `uncaughtException` handler at all. Any uncaught throw gets
   Node's default: exit code 1, message to a TTY nobody reads.
2. **Nothing restarted it.** `tsx --watch` idles instead of restarting a dead
   child (see sprint 310).

Fixing only the handler would still leave OOM kills and native crashes
unrecovered; fixing only the supervisor would leave every death undiagnosed.
Both, together, are the fix.

## Context

### The dev target today
`apps/api/project.json`'s `dev` target:
```json
{
  "executor": "nx:run-commands",
  "dependsOn": ["^build"],
  "options": {
    "command": "tsx --env-file=apps/api/.env --watch apps/api/src/index.ts",
    "env": { "NODE_ENV": "development" }
  }
}
```
Keep `--watch` — hot reload is still wanted. The supervisor wraps the whole
thing and handles the case where the watcher's child dies.

### The health endpoint
The API serves `GET /health` (verified returning 200). Port comes from
`process.env['PORT'] ?? 7001` (`apps/api/src/index.ts:78`). The supervisor's
`--health-url` should respect the same override rather than hardcoding 7001.

### What the handler should do — and why it differs from develemit-hq's
develemit-hq deliberately **swallows** `uncaughtException` and keeps running
(`server.ts:112`). Do **not** copy that here. Node's own guidance is that after
an uncaught exception the process is in an undefined state; the safe move is to
log richly and exit, letting a supervisor start a clean process. We now have a
supervisor, so this API should:
- log the error with full stack via `app.log.fatal`/`error`,
- flush the logger,
- `process.exit(1)`.

The supervisor then restarts it and records the death. Say this explicitly in a
code comment, because the two apps intentionally differ and a future reader
will otherwise "fix" the inconsistency.

### Testability
Process-level handlers are awkward to unit test. Extract the formatting into a
small pure function (e.g. `formatFatalError(err): string` or a record object)
and test that directly, rather than trying to assert on a real crash. The
handler itself is then a thin call.

`apps/api` already has a test suite (`apps/api/src/routes/*.test.ts`) run by
`pnpm test`.

## Tasks
1. Add an `uncaughtException` handler to `apps/api/src/index.ts` that logs the
   full error and exits non-zero. Comment why it exits where the
   `unhandledRejection` handler does not, and why develemit-hq differs.
2. Extract the error-formatting into a pure, exported helper so it can be
   tested without crashing a process.
3. Register both handlers **before** `await app.listen(...)` so a failure
   during startup is caught too.
4. Change `apps/api/project.json`'s `dev` target to run through
   `scripts/serve-supervised.sh`, passing `--name emit-infra-api`, the health
   URL (honouring `PORT`), and the existing tsx command after `--`.
5. Verify the composed behaviour end to end: start `dev`, kill the **grandchild**
   server process only (leaving the tsx watcher alive — the real failure shape),
   and confirm the supervisor detects it via health probe, restarts it, and
   appends a death record.
6. Confirm Ctrl-C still stops everything cleanly and leaves no orphans.
7. Add a test file for the formatting helper.

## Files involved
- `apps/api/src/index.ts` — add `uncaughtException`, move handler registration
  before `listen`, extract the formatter
- new file: `apps/api/src/lib/fatal.ts` (or similar) — the pure formatter
- new file: `apps/api/src/lib/fatal.test.ts` — its tests
- `apps/api/project.json` — `dev` target now goes through the supervisor
- `scripts/serve-supervised.sh` — consumed, not modified (sprint 310)

## Acceptance criteria
- [ ] Killing only the server process while the `tsx --watch` watcher stays
      alive results in an automatic restart and exactly one death record in
      `.server-deaths.jsonl` — demonstrate with real commands and paste the
      record.
- [ ] An uncaught exception logs the full stack and exits non-zero (not
      swallowed), and the supervisor brings the API back.
- [ ] Handlers are registered before `app.listen`, so a startup-time throw is
      caught.
- [ ] `PORT` override is honoured by the health URL — a non-default port works.
- [ ] Ctrl-C stops supervisor and server with no orphaned processes
      (`pgrep -f apps/api/src/index.ts` empty afterward).
- [ ] `apps/api/src/lib/fatal.test.ts` covers the formatter, including an error
      with no stack and a non-Error thrown value.
- [ ] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- develemit-hq — sprint 312.
- The dashboard route/card for deaths — sprint 313.
- Changing the `unhandledRejection` handler's existing non-exiting behaviour.
- Any change to production/deploy behaviour; this is the local dev path only.
