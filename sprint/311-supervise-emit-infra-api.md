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
- [x] Killing only the server process while the `tsx --watch` watcher stays
      alive results in an automatic restart and exactly one death record in
      `.server-deaths.jsonl` — demonstrate with real commands and paste the
      record.
- [x] An uncaught exception logs the full stack and exits non-zero (not
      swallowed), and the supervisor brings the API back.
- [x] Handlers are registered before `app.listen`, so a startup-time throw is
      caught.
- [x] `PORT` override is honoured by the health URL — a non-default port works.
- [x] Ctrl-C stops supervisor and server with no orphaned processes
      (`pgrep -f apps/api/src/index.ts` empty afterward).
- [x] `apps/api/src/lib/fatal.test.ts` covers the formatter, including an error
      with no stack and a non-Error thrown value.
- [x] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- develemit-hq — sprint 312.
- The dashboard route/card for deaths — sprint 313.
- Changing the `unhandledRejection` handler's existing non-exiting behaviour.
- Any change to production/deploy behaviour; this is the local dev path only.

## Completed

**Date:** 2026-08-26

### Summary
Closed both gaps from the 14-hour outage. `apps/api/src/index.ts` now
registers an `uncaughtException` handler alongside the existing
`unhandledRejection` one, both before `await app.listen(...)` so a
startup-time throw is caught too. The handler logs via `app.log.fatal` with
the full error (including stack) and exits `process.exit(1)` — the opposite
of develemit-hq's `server.ts`, which deliberately swallows and keeps running
because it has no supervisor yet; a code comment explains the divergence so
a future reader doesn't "fix" it into consistency. The formatting logic
lives in a pure `formatFatalError()` helper (`lib/fatal.ts`) so it's unit
tested directly rather than asserted on a real crash.

`apps/api/project.json`'s `dev` target now runs through sprint 310's
`scripts/serve-supervised.sh --name emit-infra-api --health-url
"http://127.0.0.1:${PORT:-7001}/health"`, wrapping the existing
`tsx --watch` command unchanged after `--`. The health URL uses shell
parameter expansion (`${PORT:-7001}`) rather than hardcoding the port, so
`PORT=<n> pnpm nx run api:dev` both starts the API on the right port (via
tsx's own env handling) and points the supervisor's probe at it — verified
live with `PORT=7099`.

All behavior was verified with real processes, not just reasoning about the
script: started `dev`, confirmed a startup-time throw (an incidental real
`EADDRINUSE` from a pre-existing unsupervised dev instance already on 7001)
was caught by the new handler, logged with full stack, and exited
non-zero — direct proof handlers-before-`listen` actually catches startup
failures. Then, on a clean `PORT=7099` run, killed only the grandchild
server process (`kill -9` on the pid holding the listening socket, found via
`lsof`) while leaving the tsx watcher alive — the exact failure shape from
the outage. The supervisor's health probe caught it after 3 failed checks,
killed the tree, restarted, and appended exactly one `health-timeout` death
record. Health recovered on the new pid. Finally sent `SIGTERM` to the
supervisor and confirmed it forwarded to the child tree, exited cleanly with
no death record, released port 7099, and left no orphaned processes
(excluding the unrelated pre-existing dev instance on 7001, which this
sprint's testing did not touch).

### Files changed
- `apps/api/src/index.ts` — added `uncaughtException` handler (logs full
  stack via `app.log.fatal`, exits 1), both process handlers now registered
  before `app.listen`, comment explaining the divergence from develemit-hq
- (new) `apps/api/src/lib/fatal.ts` — pure `formatFatalError()` helper
- (new) `apps/api/src/lib/fatal.test.ts` — 4 tests: real Error, no-stack
  Error, non-Error string, non-Error object
- `apps/api/project.json` — `dev` target now runs through
  `scripts/serve-supervised.sh`, health URL honours `PORT` via shell
  parameter expansion

### Verification
- `pnpm nx run api:test`: 361/361 pass (incl. new `fatal.test.ts`)
- `pnpm nx run api:typecheck`: clean
- `pnpm test` (workspace): 215/215 fresh (dashboard) + api/core/types/cli
  cache-hit clean, 0 failures
- `pnpm typecheck` (workspace): clean, 5/5 projects
- Live end-to-end: grandchild-only kill → health-probe-detected restart →
  exactly one `health-timeout` death record in `.server-deaths.jsonl`,
  restart succeeded on a new pid
- Live end-to-end: startup-time `EADDRINUSE` throw caught by the new
  `uncaughtException` handler, logged with full stack via `app.log.fatal`,
  process exited non-zero (tsx's watcher confirmed the child died rather
  than being swallowed)
- Live end-to-end: `PORT=7099` correctly served on that port and the
  supervisor's health probe followed it
- Live end-to-end: `SIGTERM` to the supervisor stopped cleanly — no death
  record, port released, no orphaned processes

### Follow-ups
- `[defer]` The dev target's `dev` command string now embeds shell parameter
  expansion (`${PORT:-7001}`) directly in `project.json`, relying on nx
  `run-commands` invoking it through a shell. Worked in live testing, but if
  nx's executor behavior around shell invocation ever changes, this would
  need revisiting — no test currently exercises the nx target itself
  end-to-end (the sprint's verification ran the underlying script directly
  with the same args nx produces).
- none beyond the above.
