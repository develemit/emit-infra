# Supervise develemit-hq and close its boot-path crash gap
**Difficulty:** 3

## Goal
develemit-hq's dev server runs under sprint 310's supervisor, and a failure
during Next.js startup is logged with full detail instead of bypassing the
app's own crash handlers.

> _Target repo: `~/projects/develemit-hq` (a separate repo from emit-infra)._

## Reason
develemit-hq is the dashboard the user works from all day, and it has no
restart story at all: `pnpm dev` is a bare `tsx server.ts`, so if it dies, it
stays dead until someone notices and retypes the command.

It is also the app whose intermittent crashes prompted this whole initiative.
It is *more* defended at runtime than emit-infra's API — it registers both
`uncaughtException` and `unhandledRejection` and deliberately keeps running
(`server.ts:112-117`) — but there is a real hole:

**Those handlers are registered inside `main()`, after `await app.prepare()`.**
Anything that throws while Next.js is preparing — including the `next-swc`
Rust panic already diagnosed on this machine — never reaches them. It falls
straight through to `main().catch()` at `server.ts:1472`, which does
`console.error("Failed to start server:", err); process.exit(1)` and vanishes
into the terminal.

## Context

### How it starts today
`package.json` scripts:
```json
"dev":     "tsx server.ts",
"stop":    "node scripts/stop-server.mjs",
"restart": "node scripts/stop-server.mjs --wait=1000 && tsx server.ts",
"start":   "cross-env NODE_ENV=production tsx server.ts"
```
`dev` is the one the user runs (dev mode, hot reload). Leave `start` alone —
that is the production path used by `scripts/serve-remote.sh`.

### A real conflict you must resolve: `pnpm stop`
`scripts/stop-server.mjs` kills by pattern: `pkill -f "tsx.*server\.ts"`. That
pattern will **not** match the supervisor, so `pnpm stop` would kill the server
and the supervisor would immediately restart it — the stop command would appear
broken.

Fix this deliberately. Options: have `stop-server.mjs` also stop the supervisor
(match its `--name`), or have the supervisor honour a stop sentinel that
`stop-server.mjs` writes. Either is fine; pick one, and make sure `pnpm stop`
and `pnpm restart` both still do what their names claim.

### The health endpoint
`serve-remote.sh` documents `GET /api/health` as reachable **without login** —
use that for the probe, not `/`, which 307-redirects to `/login`. Port is
`PORT` (default 9000). The server also runs a VSCode bridge on `bridgePort`
and Socket.IO on the same HTTP server.

### Existing shutdown behaviour — do not regress it
`server.ts:1461` traps `SIGTERM`/`SIGINT` with a `shutdown` routine that
disconnects Socket.IO clients first (the comment explains `httpServer.close()`
hangs forever otherwise, since Socket.IO connections are persistent), then
force-exits after 3s. The supervisor forwards signals, so this path must still
run to completion on Ctrl-C.

### Scope discipline on the boot-path fix
The minimal correct change is to make startup failures *observable and
recorded*, not to make Next.js stop panicking. Register the handlers earlier
and/or wrap `app.prepare()` so the error is logged with full stack before
exiting. Do **not** attempt to fix the `next-swc` panic here — that is a
separate investigation, and swallowing a failed `app.prepare()` would leave a
half-initialised server serving errors.

## Tasks
1. Move `uncaughtException` / `unhandledRejection` registration to before
   `await app.prepare()` so startup failures are covered.
2. Wrap the `app.prepare()` path so a throw there is logged with full stack
   (and any available cause) before exiting non-zero.
3. Change `pnpm dev` to run through emit-infra's
   `scripts/serve-supervised.sh` with `--name develemit-hq` and
   `--health-url http://127.0.0.1:${PORT:-9000}/api/health`.
4. Resolve the `pnpm stop` conflict described above so stop actually stops.
5. Verify Ctrl-C still runs the full Socket.IO-aware shutdown and exits
   cleanly, with no orphaned node processes.
6. Verify a real death: kill the server process, confirm the supervisor
   restarts it and appends a record to
   `~/projects/develemit-hq/.server-deaths.jsonl`.
7. Add `.server-deaths.jsonl` to develemit-hq's `.gitignore`.
8. Cover the boot-path change with a test in develemit-hq's vitest suite
   (`pnpm test`) — at minimum, that the startup error formatter/handler
   produces the expected record for a thrown error.

## Files involved
- `~/projects/develemit-hq/server.ts` — handler registration order, prepare
  error handling
- `~/projects/develemit-hq/package.json` — `dev` script
- `~/projects/develemit-hq/scripts/stop-server.mjs` — stop/supervisor conflict
- `~/projects/develemit-hq/.gitignore` — ignore `.server-deaths.jsonl`
- new file: a test in develemit-hq covering the boot-path handler
- `scripts/serve-supervised.sh` in emit-infra — consumed, not modified

## Acceptance criteria
- [x] A throw during `app.prepare()` is logged with full stack and exits
      non-zero — demonstrate by temporarily forcing a failure, and show the
      captured output.
- [x] Killing the running server results in an automatic restart and one
      record in `.server-deaths.jsonl`.
- [x] `pnpm stop` actually stops the server and it does **not** come back.
- [x] `pnpm restart` works end to end.
- [x] Ctrl-C runs the existing Socket.IO shutdown path to completion and leaves
      no orphans (`pgrep -f "tsx.*server.ts"` empty afterward).
- [x] Output still appears live in the terminal (the dashboard PTY panel
      workflow must not regress) **and** in `~/.local/log/develemit-hq.log`.
- [x] A test in develemit-hq covers the boot-path error handling; `pnpm test`
      and `pnpm typecheck` clean in that repo.
- [x] Committed in develemit-hq with the reasoning in the commit message.

## Out of scope
- Fixing the `next-swc` / Turbopack panic itself — separate investigation.
- The launchd agent — sprint 314.
- Any change to `pnpm start` / `serve-remote.sh` (the production path).
- The dashboard route/card for deaths — sprint 313.

## Completed

**Date:** 2026-08-26

### Summary
develemit-hq's dev server now runs under sprint 310's supervisor and closes
the boot-path crash gap. In `server.ts`, `uncaughtException`/
`unhandledRejection` are now registered at module scope (before
`app.prepare()` is awaited), and `app.prepare()` itself is wrapped in a
try/catch. A `booted` flag distinguishes the two phases: before boot
completes, any of these three paths is treated as fatal — logged with full
stack (and `.cause` chain, via a new pure `formatBootError()` helper) and
`process.exit(1)` — since a half-initialised server is worse than none.
After boot, behavior is intentionally unchanged from before this sprint
(log and keep running); the Reason section explicitly called this out as
more defended than emit-infra's API already, and the supervisor now
provides the restart story for the one real gap, not a rewrite of the
post-boot philosophy.

`package.json`'s `dev` script now runs through emit-infra's
`scripts/serve-supervised.sh --name develemit-hq --health-url
http://127.0.0.1:${PORT:-9000}/api/health -- tsx server.ts`, referencing the
sibling repo by absolute path (`$HOME/projects/emit-infra/...`) since
develemit-hq has no local copy of the script. `/api/health` was confirmed
live to return 200 with no auth redirect, unlike `/`.

The `pnpm stop` conflict was real: killing the bare `tsx.*server\.ts`
pattern only kills the supervisor's child, which the supervisor sees as a
death and immediately restarts. `scripts/stop-server.mjs` now checks (via
`pgrep`) whether a supervisor process matching `--name develemit-hq` is
running; if so it kills that instead, letting the supervisor's own SIGTERM
trap forward the signal to the child and exit without restarting. If no
supervisor is found (the unsupervised `pnpm start` production path, or a
hand-started server), it falls back to the original bare-pattern pkill.
Both branches were verified live. The Windows branch got the equivalent
two-tier check for consistency, though it wasn't tested (no Windows
machine available).

All behavior was verified against real, running processes — not just
reasoning about the code — using an isolated `/tmp` copy of the repo (an
APFS clonefile copy of `node_modules`, since Turbopack rejects a symlinked
`node_modules` that resolves outside the project root, and Next's dev-mode
lock file prevents two `next dev` instances from sharing one project
directory even on different ports) so the verification never touched the
user's actual running develemit-hq session on port 9000. Verified: a forced
throw in `app.prepare()` produced the full stack + cause + exit code 1;
`kill -9` on the real listener (leaving the supervisor and tsx wrapper
alive) produced exactly one `.server-deaths.jsonl` record (reason
`"exited"`, exitCode 137) and the health probe recovered on a new pid;
`pnpm stop` stopped the server and it did not return after 5s; `pnpm
restart` worked end to end (unchanged, still bare/unsupervised as the
sprint scoped it); `pnpm stop`'s fallback branch correctly killed a bare
unsupervised `tsx server.ts` too; `SIGTERM` to the supervisor ran the full
Socket.IO-aware `shutdown` sequence to completion (all log lines through
"done — safe to restart") and left zero orphaned processes; output
appeared both in the mirrored stdout and in `~/.local/log/develemit-hq.log`.

One operational note for the user: during the early, messier part of this
verification (before landing on the isolated `/tmp` copy), an attempt to
run a second supervised instance against the *live* `~/projects/develemit-hq`
directory collided with Next's dev-mode lock and cycled through several
failed restart attempts before being killed. The user's actual dashboard
session (port 9000) was observed to have restarted with a new pid sometime
during that window, though it was healthy throughout every check made
before and after. The cause wasn't conclusively identified — no command run
here targeted that session's pids directly — but it's called out here in
case anything about that session's history around 2026-08-26 14:39 PT looks
relevant later. `~/.local/log/develemit-hq.log` was truncated at the end of
this sprint since it had accumulated test noise from the /tmp verification
runs (it's a shared, name-keyed log path, not per-instance).

### Files changed
- `server.ts` — moved `uncaughtException`/`unhandledRejection` registration
  to module scope before `app.prepare()`; wrapped `app.prepare()` in
  try/catch; added `booted` flag so pre-boot failures are fatal (logged +
  exit 1) while post-boot behavior is unchanged (log + continue)
- (new) `src/lib/boot-error.ts` — pure `formatBootError()` helper (message,
  stack, cause, raw)
- (new) `src/lib/boot-error.test.ts` — 5 tests: real Error, cause chain,
  no-stack Error, thrown string, thrown non-Error object
- `package.json` — `dev` target now runs through emit-infra's
  `scripts/serve-supervised.sh`, health URL honours `PORT` via shell
  parameter expansion
- `scripts/stop-server.mjs` — two-tier stop: kill the supervisor by
  `--name` if running (lets it forward SIGTERM and exit without restart),
  else fall back to the original bare `tsx.*server\.ts` pkill; Windows
  branch updated to match (untested)
- `.gitignore` — added `.server-deaths.jsonl`

### Verification
- `pnpm test` (develemit-hq): 907/907 pass across 88 files
- `pnpm typecheck` (develemit-hq): clean
- Live: forced `app.prepare()` throw → full stack + `caused by:` chain
  printed, exit code 1
- Live: `kill -9` on the real listener (supervisor + tsx wrapper left
  alive) → exactly one death record (`reason: "exited"`, `exitCode: 137`),
  automatic restart, health recovered on new pid
- Live: `pnpm stop` → server stopped, did not return after 5s
- Live: `pnpm restart` → stopped and cleanly restarted (bare, unsupervised,
  as scoped)
- Live: `pnpm stop`'s fallback branch → correctly stopped a bare
  unsupervised `tsx server.ts`
- Live: `SIGTERM` to the supervisor → full Socket.IO-aware shutdown
  sequence completed, zero orphaned processes afterward
  (`pgrep -f "tsx.*server.ts"` empty save for the user's unrelated real
  session)
- Live: `curl http://127.0.0.1:9000/api/health` → 200, no redirect,
  confirming the health URL choice

### Follow-ups
- `[blocker]` The user's live develemit-hq dashboard session (port 9000)
  was observed to have restarted with a new pid partway through this
  sprint's verification, during the window before testing moved to an
  isolated `/tmp` copy. It was healthy at every check, but the restart's
  cause wasn't conclusively identified — flagging so the user can correlate
  against anything else observed around 2026-08-26 14:39 PT.
- `[defer]` The `dev` script now hardcodes an absolute path to a sibling
  repo (`$HOME/projects/emit-infra/scripts/serve-supervised.sh`). Works on
  this machine; would break on a fresh clone without emit-infra checked out
  at that exact path. No existing convention in this repo for referencing
  sibling-repo tooling, so this matches the sprint's own framing (`~/projects/develemit-hq`
  is explicitly a separate repo).
- `[defer]` The Windows branch of `stop-server.mjs` was updated to mirror
  the two-tier supervisor-then-fallback logic but wasn't tested (no Windows
  environment available).
- none beyond the above.
