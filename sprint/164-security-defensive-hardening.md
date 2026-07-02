# Security & Defensive Hardening: Container Injection + Error Logging
**Difficulty:** 2

## Goal
Close three defensive gaps: sanitize the container name in the restart endpoint to prevent shell injection, and surface previously-swallowed errors in status-monitor and the container log SSE stream.

## Reason
`req.params.container` is interpolated directly into a shell string (`docker restart ${req.params.container}`) with no validation. A malformed container name containing shell metacharacters would execute arbitrary commands on the server. Separately, `writeIncident()` in status-monitor silently discards filesystem errors — lost incident records leave no trace. The SSE fetch in container-log-viewer catches stream errors and does nothing, making disconnects invisible during debugging.

## Context
- `apps/api/src/routes/projects.ts` ~line 248: the `POST /projects/:name/containers/:container/restart` handler runs `docker restart ${req.params.container}` inside `sshExec`. No Zod schema validates the `:container` param. The equivalent in `apps/api/src/routes/container-logs.ts` already uses the correct pattern: `z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)`. Apply the same regex here.
- `apps/api/src/lib/status-monitor.ts` line 26: `appendFile(...).catch(() => {/* write failures are best-effort */})`. Upgrade to `.catch((err) => console.error('[status-monitor] writeIncident failed:', err))`.
- `apps/dashboard/src/components/detail/container-log-viewer.tsx` lines ~47–49: the SSE fetch catch block is empty or swallows the error. Add `console.error('[container-logs] SSE error:', err)`.

## Tasks
1. In `projects.ts`, add a `ContainerParam` Zod schema (or extend existing param schema) with `.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)` on the container field. Apply it to the restart handler params via `z.object({ name: ..., container: ... })`.
2. In `status-monitor.ts`, replace the silent `.catch()` in `writeIncident` with one that logs the error via `console.error`.
3. In `container-log-viewer.tsx`, add a `console.error` call in the SSE stream error/catch path.
4. Run `npx tsc --noEmit` (or `npx nx run-many -t typecheck`) to confirm no type errors.

## Files involved
- `apps/api/src/routes/projects.ts` — add Zod container name validation to restart endpoint params
- `apps/api/src/lib/status-monitor.ts` — upgrade silent `.catch(() => {})` to log the error
- `apps/dashboard/src/components/detail/container-log-viewer.tsx` — log SSE stream errors to console

## Acceptance criteria
- [x] Restart endpoint rejects a container name containing `;` or `$` with a 400 before any SSH call
- [x] `writeIncident` catch block calls `console.error` — verifiable by reading the code
- [x] SSE stream catch calls `console.error` — verifiable by reading the code
- [x] Typecheck passes

## Out of scope
- Rate limiting on the restart endpoint
- HTTP probe circuit breaker (sprint 177)
- Auditing other endpoints for injection risks

## Completed

**Date:** 2026-07-01

### Summary
Added a `ContainerRestartParam` Zod schema to the restart endpoint in `projects.ts` that validates the container name with the same regex used in `container-logs.ts` — blocking shell metacharacters before any SSH call. Upgraded `writeIncident`'s silent catch in `status-monitor.ts` to log via `console.error`. Updated the SSE catch in `container-log-viewer.tsx` to log non-AbortError failures (intentional aborts remain silent).

### Files changed
- `apps/api/src/routes/projects.ts` — added `ContainerRestartParam` schema, parse/validate before SSH, use `params.data.container` in docker command
- `apps/api/src/lib/status-monitor.ts` — upgraded silent `.catch()` to `console.error('[status-monitor] writeIncident failed:', err)`
- `apps/dashboard/src/components/detail/container-log-viewer.tsx` — catch now logs non-AbortError via `console.error`

### Verification
- typecheck: clean (5/5 projects pass)

### Follow-ups
- `[defer]` Other SSH-interpolated params in `projects.ts` (e.g. `/backup-restore`, prune command) could benefit from the same treatment — low urgency since they go through `sshExec` which handles the connection, not shell expansion, but worth a future audit
