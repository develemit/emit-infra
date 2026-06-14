# `emit-infra status` queries `/healthz` for live build validation
**Difficulty:** 3

## Goal
Extend `emit-infra status` to SSH-curl the project's `/healthz` endpoint on the
server and display the running build number alongside system stats. Gives operators
instant confirmation that the right build is live without a separate SSH session.

## Reason
After a deploy, operators currently have to either SSH in manually and `cat
.deployed-version`, or trust that the CI green-check means the right build is
running. The `.deployed-version` file only captures what CI wrote — it doesn't
confirm the running container is serving the expected build. A live `/healthz`
curl does. This also creates a validation loop for the five upcoming projects
(emit-vision, martialops, easy-living, develemail, diner-decider): once they each
add a `/healthz` route, `emit-infra status` surfaces it automatically.

## Context
- `apps/cli/src/commands/status.ts` — currently SSHes in and runs a bash one-liner
  (`STATUS_SCRIPT`) via `sshExec`. The output prints directly to stdout.
- `STATUS_SCRIPT` is a `&&`-chained set of `echo` + system commands. Extend it
  with a healthz curl section at the end.
- The app port is read from `config.deploy?.appPort` (type `string | undefined`
  in `ProjectConfig`). Default to `"3001"` when absent — that's the typical
  Fastify API port in emit-infra projects. Do NOT try to auto-detect or loop
  over ports.
- The curl should be **non-fatal**: if the endpoint is unreachable (port not
  configured, app not yet wired), the status command still succeeds and prints
  a soft "healthz unavailable" note instead of exiting non-zero.
- Use `curl -sf --max-time 3` (silent + fail + 3s timeout). Pipe to
  `python3 -m json.tool 2>/dev/null || cat` for a light pretty-print without
  requiring `jq`.
- The expected `/healthz` response shape (documented for project authors):
  ```json
  { "status": "ok", "build": "142", "service": "api", "uptime": 3600 }
  ```
  The status command only displays the raw (or pretty-printed) JSON — it does
  not parse or validate it. Keep it simple.

## Tasks
1. In `status.ts`, read `config.deploy?.appPort ?? '3001'` as `appPort` before
   building the SSH script.

2. Append a healthz section to `STATUS_SCRIPT` (or build it as a separate variable
   and concat):
   ```ts
   const healthzScript = [
     `echo "=== healthz (port ${appPort}) ==="`,
     `curl -sf --max-time 3 http://localhost:${appPort}/healthz ` +
       `| python3 -m json.tool 2>/dev/null || echo "(healthz unavailable)"`,
   ].join(' && ')
   ```
   Append it to the existing `STATUS_SCRIPT` string with ` && `.

3. Because `STATUS_SCRIPT` is currently a module-level const (constructed before
   any config is loaded), refactor it to a function:
   ```ts
   function buildStatusScript(appPort: string): string {
     return [
       `echo "=== uptime ===" && uptime`,
       `echo "=== disk ===" && df -h /`,
       `echo "=== memory ===" && free -h`,
       `echo "=== containers ===" && docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`,
       `echo "=== healthz (port ${appPort}) ==="`,
       `curl -sf --max-time 3 http://localhost:${appPort}/healthz | python3 -m json.tool 2>/dev/null || echo "(healthz unavailable — add /healthz to the API or set deploy.appPort in .emit-infra.json)"`,
     ].join(' && ')
   }
   ```
   Call it as `buildStatusScript(config.deploy?.appPort ?? '3001')` inside the
   action handler.

4. Run `pnpm nx run cli:typecheck` — confirm clean.

## Files involved
- `apps/cli/src/commands/status.ts` — refactor `STATUS_SCRIPT` const to
  `buildStatusScript(port)` function; read port from config; append healthz curl

## Acceptance criteria
- [x] `emit-infra status` output includes an `=== healthz (port N) ===` section
- [x] When `/healthz` responds with JSON, the output is pretty-printed
- [x] When `/healthz` is unreachable, the command still exits 0 with the
  "healthz unavailable" message (not a crash)
- [x] Port is read from `config.deploy.appPort` when set, otherwise `3001`
- [x] `pnpm nx run cli:typecheck` clean

## Completed

**Date:** 2026-06-11

### Summary
Refactored the module-level `STATUS_SCRIPT` const into a `buildStatusScript(appPort)` function so the SSH script can incorporate the project's configured app port. The function appends a healthz curl section that pretty-prints JSON via `python3 -m json.tool` and falls back to a soft "(healthz unavailable)" message when the endpoint is unreachable — the status command never crashes on a missing healthz.

### Files changed
- `apps/cli/src/commands/status.ts` — replaced `STATUS_SCRIPT` const with `buildStatusScript(appPort)` function; read port from `config.deploy?.appPort ?? '3001'`; added healthz curl section

### Verification
- `pnpm nx run cli:typecheck`: clean
- Code inspection: healthz header uses interpolated port, curl uses `-sf --max-time 3`, fallback `|| echo` ensures exit 0

### Follow-ups
- `[defer]` Each project (emit-vision, martialops, easy-living, develemail, diner-decider) still needs to add its own `/healthz` route for this to surface useful data
- `[defer]` Blue-green slot-aware port selection — the active slot may use a different port than `appPort`; revisit once blue-green is production-proven

## Out of scope
- Parsing or validating the healthz JSON shape (just display it)
- Failing the status command on a bad healthz response
- Adding `/healthz` to any project's application code (that's each project's work)
- Blue-green slot-aware port selection (the active slot's API port may differ
  from appPort — leave that for a follow-up once blue-green is production-proven)
