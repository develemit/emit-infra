# Sprint 151 — Backup API route tests

> _Promoted from sprint-125 follow-up, 2026-07-01._

**Difficulty:** 2

## Goal

Write route-level tests for the four backup endpoints: list, delete, trigger, and download. Verify key validation, 404 on missing bucket, and basic parse edge cases without hitting a real R2 bucket.

## Context

- `apps/api/src/routes/projects.ts` contains the backup routes:
  - `GET /projects/:name/backups` — lists backups by running `aws s3 ls` via SSH
  - `DELETE /projects/:name/backups/:key` — deletes a single backup object
  - `POST /projects/:name/backups/trigger` — runs the backup script on the server
  - `GET /projects/:name/backups/:key/download` — generates a presigned URL (or similar)
- The test suite in `apps/api/` likely uses `vitest` + `@fastify/test`. Read existing test files to understand the pattern before writing new ones.
- `BACKUP_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.dump$/` — key validation regex used in delete and download routes.
- No actual SSH or R2 calls should happen in tests — mock `sshExec` and `findProject`.
- Focus on: correct HTTP status codes, key regex validation (valid/invalid keys), `404` when `postgres.backupBucket` is not configured.

## Tasks

1. Read existing test files in `apps/api/` (or `apps/api/src/`) to find the test framework and mock patterns.
2. Create `apps/api/src/routes/backup.test.ts` (or the appropriate location).
3. Write tests for:
   - `GET /projects/:name/backups` — 404 when project not found, 404 when no bucket, 200 on success with mocked SSH
   - `DELETE /projects/:name/backups/:key` — 400 on invalid key (traversal attempt, missing extension), 404 on no bucket, 200 on success
   - `POST /projects/:name/backups/trigger` — 404 on no bucket, 200 on success
4. Run `pnpm nx test api --skip-nx-cache`. Fix any failures.

## Acceptance criteria

- [ ] At least 8 test cases across the three endpoints
- [ ] Invalid key patterns (e.g. `../../etc/passwd`, `backup.sql`) return 400
- [ ] Missing bucket returns 404, not 503
- [ ] `pnpm nx test api --skip-nx-cache` passes clean
