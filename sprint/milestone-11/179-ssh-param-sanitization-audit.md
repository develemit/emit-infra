# Sprint 179 — SSH parameter sanitization audit

> _Promoted from sprint-164 follow-up, 2026-07-02._

## Goal
Audit and sanitize all SSH-interpolated parameters in the API to prevent shell injection, matching the treatment applied in sprint 164.

## Context
Sprint 164 hardened the most common SSH paths in `apps/api/src/routes/projects.ts` (status probe, deploy, etc.) by sanitizing user-supplied `name` params before interpolation into shell commands. However, several other routes also interpolate user input into SSH commands:

- Backup restore path (`/backup-restore`)
- Docker prune command
- Any other `sshExec` call sites that accept user-controlled values

The `sshExec` helper handles the SSH connection itself, but the *commands* passed to it are string-interpolated — a malicious project name like `; rm -rf /` could execute arbitrary commands if not sanitized.

Sprint 164's approach: validate that params match `/^[a-zA-Z0-9._-]+$/` before interpolation. Apply the same pattern everywhere.

## Tasks
1. Read `apps/api/src/routes/projects.ts` and search for all `sshExec` call sites.
2. Read all other route files (`apps/api/src/routes/*.ts`) for `sshExec` usage.
3. For each call site, check whether the interpolated values are sanitized (validated against a safe pattern).
4. Add the same validation guard (`/^[a-zA-Z0-9._-]+$/` or equivalent) to any unprotected call sites.
5. If there are 3+ call sites using the same guard, extract a `assertSafeParam(value: string)` helper.
6. Typecheck.
7. Run existing API tests.

## Acceptance criteria
- [x] Every `sshExec` call site that interpolates user input validates the input first
- [x] No shell metacharacters can reach a remote command via API params
- [x] Typecheck passes
- [x] API tests pass

## Completed

**Date:** 2026-07-02

### Summary
Audited all 20+ `sshExec` call sites across the API routes. Found that 7 route files already had proper `nameSchema` with `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` regex validation (`ufw.ts`, `cron.ts`, `cert.ts`, `disk.ts`, `response-times.ts`, `secrets.ts`, `nginx-endpoints.ts`), while `operations.ts` had `NameParam` with the regex. Four files were missing the guard: `projects.ts` (8 routes), `postgres.ts` (1 route), `rollback.ts` (NameParam without regex), and `secrets-sync.ts` (NameParam without regex).

Extracted `SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` to `project-helpers.ts` as a shared constant. Added `nameSchema` to `projects.ts` and `postgres.ts` using this constant, applied it to every route handler that was missing it, and replaced all `req.params.name` interpolations in SSH commands with the validated `name` variable. Strengthened `NameParam` in `rollback.ts` and `secrets-sync.ts` with the same regex. Fixed `backup.test.ts` mock to export `SAFE_NAME_RE`.

Key defense: `findProject()` already provides a first line of defense (exact config match), so the risk was low — but the new validation ensures defense-in-depth even if project config were somehow compromised.

### Files changed
- `apps/api/src/lib/project-helpers.ts` — added `SAFE_NAME_RE` export
- `apps/api/src/routes/projects.ts` — added `nameSchema`, applied to 8 routes, replaced `req.params.name` with validated `name` in SSH commands, strengthened `ContainerRestartParam`
- `apps/api/src/routes/postgres.ts` — added `z` import, `nameSchema`, validated before SSH
- `apps/api/src/routes/rollback.ts` — added `SAFE_NAME_RE` regex to `NameParam`
- `apps/api/src/routes/secrets-sync.ts` — added `SAFE_NAME_RE` regex to `NameParam`
- `apps/api/src/routes/backup.test.ts` — added `SAFE_NAME_RE` to mock

### Verification
- `npx nx run api:typecheck`: clean
- `npx nx run api:test`: 106/106 pass

### Follow-ups
none
