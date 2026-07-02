# Sprint 125 — Backup management API routes

**Difficulty:** 3

## Goal

Add four new routes to the projects API that let the dashboard list, delete, trigger, and generate download links for database backups stored in Cloudflare R2.

## Reason

The dashboard currently shows only a last-run/pass-fail chip for backups. Users have no way to see what dumps exist, free up R2 storage, trigger an on-demand backup, or pull a dump to their local machine. These four routes are the backend for the full management UI (sprint 126).

## Context

- `apps/api/src/routes/projects.ts` — add all four routes here, directly after the existing `GET /projects/:name/backup-status` route (around line 239). Follow the exact pattern of that route: `findProject` → resolve host + key → `sshExec` → parse → reply.
- `packages/core/src/ssh.ts` — `sshExec(host, command, keyPath): Promise<string>` already handles muxing. Use it for all four routes.
- Backup script is installed at `/usr/local/bin/emit-db-backup-{project_name}` by the ansible `postgres-backup` role.
- R2 credentials are in `/opt/{project_name}/.env` on each server: `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The standard way to use them in a shell command is `source /opt/{name}/.env`.
- Bucket name lives in `project.config.postgres.backupBucket`. Guard all four routes with a 404 if this field is absent.
- `aws` CLI is already installed on every server (the `postgres-backup` ansible role installs it). Use it directly — no need to construct S3 signed requests in Node.

### SSH command patterns

```bash
# list
source /opt/{name}/.env && \
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION="auto" \
  aws s3 ls "s3://{bucket}/" \
  --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"

# delete
source /opt/{name}/.env && \
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION="auto" \
  aws s3 rm "s3://{bucket}/{key}" \
  --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"

# presign (1-hour expiry)
source /opt/{name}/.env && \
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION="auto" \
  aws s3 presign "s3://{bucket}/{key}" \
  --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com" \
  --expires-in 3600

# trigger (run existing backup script)
/usr/local/bin/emit-db-backup-{name} 2>&1
```

### `aws s3 ls` output format

```
2026-06-28 02:00:11      4823044 tastease_20260628_020010.dump
2026-06-29 02:00:09      4901122 tastease_20260629_020008.dump
```

Parse each line as: `[date, time, sizeBytes, key]` split on whitespace. Return an array of `{ key: string; sizeBytes: number; lastModified: string }` sorted newest-first.

### Key validation

The `key` path param for DELETE and download is a filename like `tastease_20260628_020010.dump`. Validate it with a regex before including it in a shell command: `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.dump$/`. Return 400 if it doesn't match.

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 220–240 to confirm the exact insertion point and surrounding style.
2. Add `GET /projects/:name/backups` — returns `{ backups: BackupObject[] }` where `BackupObject = { key, sizeBytes, lastModified }`. Returns `{ backups: [] }` (not 404) if the bucket is empty. Returns 503 on SSH failure.
3. Add `DELETE /projects/:name/backups/:key` — validates key, runs delete command, returns `{ ok: true }` or `{ ok: false, error }`.
4. Add `POST /projects/:name/backups/trigger` — runs the backup script, returns `{ ok: true, output }` or `{ ok: false, output }`. Long timeout — use `sshExec` with default timeout (it's already 60s in core; backup can take a few seconds for small DBs).
5. Add `GET /projects/:name/backups/:key/download` — validates key, runs presign, returns `{ url: string }`.
6. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/api/src/routes/projects.ts` — add all four routes after the backup-status route

## Acceptance criteria

- [x] `GET /projects/:name/backups` returns `{ backups: [...] }` with key, sizeBytes, lastModified per entry
- [x] `DELETE /projects/:name/backups/:key` validates the key and runs the delete
- [x] `POST /projects/:name/backups/trigger` runs `/usr/local/bin/emit-db-backup-{name}` and returns output
- [x] `GET /projects/:name/backups/:key/download` returns `{ url }` with a presigned R2 URL
- [x] All four routes return 404 when `postgres.backupBucket` is not set in project config
- [x] `:key` is validated against `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.dump$/` — 400 on mismatch
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added four backup management routes to `projects.ts` after the existing `backup-status` route. All routes guard against missing `postgres.backupBucket` (404). The list route SSHes in, runs `aws s3 ls` with env vars sourced from the project's `.env`, parses the output into `{ key, sizeBytes, lastModified }` entries sorted newest-first, and returns an empty array (not 404) when the bucket is empty. Delete and download routes validate the key against a regex before passing it to shell. The trigger route runs the pre-installed backup script directly. A subtle bug was caught during implementation: the initial array-join approach used `&&` between the aws flags, which would have run `--endpoint-url` as a separate shell command — corrected to inline string templates.

### Files changed
- `apps/api/src/routes/projects.ts` — added four routes: GET /backups, DELETE /backups/:key, POST /backups/trigger, GET /backups/:key/download

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` Route-level tests for the four new backup routes (key validation, 404 on missing bucket, parse edge cases) — deferred per sprint scope

## Out of scope

- Dashboard UI (sprint 126)
- Route-level tests (defer to a test-coverage sprint)
- Support for non-`.dump` backup formats
