# Sprint 16 — Fix hardcoded rollback health-check port

> _Promoted from sprint-07 follow-up (backlog), 2026-06-06._

## Goal

The rollback command's health check uses port 3000 regardless of the
project's configured port. Fix it to read the port from `.emit-infra.json`.

## Context

`apps/cli/src/commands/rollback.ts` line 104 hardcodes port 3000:
```
const result = await sshExec(host, `${appDir}/health-check.sh 3000 10`, key)
```

Projects like emit-vision use port 4300/4301. A rollback to those
projects would always fail the health check despite the app being
healthy — the check hits the wrong port.

The config is already loaded via `loadConfig()` which returns the
`.emit-infra.json` contents. The `deploy` section or a top-level
`appPort` field should provide the correct port.

## Tasks

1. Read the app port from config — check `config.deploy?.appPort`,
   `config.appPort`, or fall back to 3000
2. Also accept a `--port` CLI flag as an override
3. Pass the resolved port to the health-check script
4. Update the `--version` rollback path to use the same port logic

## Files involved

- `apps/cli/src/commands/rollback.ts` — fix port resolution

## Acceptance criteria

- [x] Rollback health check uses port from config when available
- [x] `--port` flag overrides config
- [x] Falls back to 3000 when no config port is set
- [x] Typecheck passes

## Completed

**Date:** 2026-06-06

### Summary
Added `appPort` field to the deploy schema in `packages/core/src/config.ts`.
Updated `apps/cli/src/commands/rollback.ts` to resolve the health-check port
from `--port` CLI flag → `config.deploy.appPort` → default `3000`. The port
is threaded through `rollbackToVersion`, `rollbackToTag`, and
`restartAndHealthCheck` so both rollback paths use the correct port.

### Files changed
- `packages/core/src/config.ts` — added `appPort` to deploy schema
- `apps/cli/src/commands/rollback.ts` — added `--port` flag, resolved port from config, passed to health-check

### Verification
- typecheck: clean

### Follow-ups
none
