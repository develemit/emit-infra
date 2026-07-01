# Sprint 137 — Secrets drift detection API

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/secrets-drift` route that SSHes into the server, reads the key names (not values) from `/opt/{name}/.env`, and diffs them against `project.config.requiredEnvKeys` to return missing, extra, and present keys.

## Reason

Secrets falling out of sync with what the app expects is a common and hard-to-diagnose production issue. A new env var added to the codebase but never set on the server means a silent crash — usually discovered by users. This route makes the gap visible before it becomes an incident.

## Context

- Builds on sprint 136: `project.config.requiredEnvKeys` is now a `string[] | undefined` field.
- Create `apps/api/src/routes/secrets.ts`. Register in `apps/api/src/index.ts`.
- SSH command to read key names only (no values):
  ```bash
  grep -v '^#' /opt/${name}/.env 2>/dev/null | grep '=' | cut -d= -f1 | tr -d ' '
  ```
  Returns one key name per line. Empty output means file is missing or empty.
- Guard: if `!project.config.requiredEnvKeys`, return `{ status: 'unconfigured' }` with HTTP 200 — not an error, just not set up.
- Diff logic (all in Node, not SSH):
  ```ts
  const serverKeys = new Set(raw.split('\n').map(k => k.trim()).filter(Boolean))
  const requiredKeys = new Set(project.config.requiredEnvKeys)
  const missing = [...requiredKeys].filter(k => !serverKeys.has(k))
  const extra   = [...serverKeys].filter(k => !requiredKeys.has(k))
  const present = [...requiredKeys].filter(k => serverKeys.has(k))
  ```
- Return type:
  ```ts
  | { status: 'unconfigured' }
  | { status: 'ok' | 'drift'; missing: string[]; extra: string[]; present: string[] }
  ```
  `status: 'ok'` when `missing.length === 0`, `'drift'` otherwise.
- TTL cache 30_000ms (drift can be fixed by syncing secrets, so short TTL is important).
- On SSH failure return 503.

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 1–15 for import paths.
2. Read `apps/api/src/index.ts` for registration pattern.
3. Create `apps/api/src/routes/secrets.ts` with the route logic.
4. Register `secretsRoutes` in `apps/api/src/index.ts`.
5. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/secrets.ts` — secrets-drift route
- `apps/api/src/index.ts` — register secrets routes

## Acceptance criteria

- [x] Returns `{ status: 'unconfigured' }` when `requiredEnvKeys` is not set in project config
- [x] Returns `{ status: 'ok', missing: [], extra: [...], present: [...] }` when all required keys are present
- [x] Returns `{ status: 'drift', missing: [...], extra: [...], present: [...] }` when keys are missing
- [x] `extra` contains keys on server not in `requiredEnvKeys` (these are allowed but flagged as informational)
- [x] Returns 503 on SSH failure
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/secrets.ts` with `GET /projects/:name/secrets-drift`. SSHes `grep -v '^#' /opt/{name}/.env | grep '=' | cut -d= -f1 | tr -d ' '` to read key names only (no values). Returns `{ status: 'unconfigured' }` when `requiredEnvKeys` is absent from the project config. Diffs server keys vs required keys in Node and returns `{ status: 'ok' | 'drift', missing, extra, present }`. TTL 30s to keep drift visible quickly after secret syncs.

### Files changed
- (new) `apps/api/src/routes/secrets.ts` — secrets-drift route
- `apps/api/src/index.ts` — registered `secretsRoutes`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Dashboard UI (sprint 138)
- Showing actual values (by design — keys only for security)
- Writing missing keys to the server
