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
- [ ] A throw during `app.prepare()` is logged with full stack and exits
      non-zero — demonstrate by temporarily forcing a failure, and show the
      captured output.
- [ ] Killing the running server results in an automatic restart and one
      record in `.server-deaths.jsonl`.
- [ ] `pnpm stop` actually stops the server and it does **not** come back.
- [ ] `pnpm restart` works end to end.
- [ ] Ctrl-C runs the existing Socket.IO shutdown path to completion and leaves
      no orphans (`pgrep -f "tsx.*server.ts"` empty afterward).
- [ ] Output still appears live in the terminal (the dashboard PTY panel
      workflow must not regress) **and** in `~/.local/log/develemit-hq.log`.
- [ ] A test in develemit-hq covers the boot-path error handling; `pnpm test`
      and `pnpm typecheck` clean in that repo.
- [ ] Committed in develemit-hq with the reasoning in the commit message.

## Out of scope
- Fixing the `next-swc` / Turbopack panic itself — separate investigation.
- The launchd agent — sprint 314.
- Any change to `pnpm start` / `serve-remote.sh` (the production path).
- The dashboard route/card for deaths — sprint 313.
