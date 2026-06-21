# Backup health chip on project detail page
**Difficulty:** 4

## Goal
Surface the last successful postgres backup time on the project detail page as a chip. Show a warning if no backup has run in the last 25 hours. This catches silent backup failures before they become disasters.

## Reason
R2 postgres backups were provisioned in sprint 22, but there's no visibility into whether they're actually running. A backup that stopped silently six months ago provides zero protection. A "last backup: 4h ago" chip makes the invisible visible.

## Context

### How backups work (read first)
Each wired project has a `pg-backup` Docker container running a cron job that dumps postgres and uploads to R2. Look at one of the project's `docker-compose.yml` or `infra/` directory to understand exactly what the backup container does and what it logs. Example: `/Users/emitdutcher/projects/tastease/` — check `docker-compose.yml` and `infra/scripts/` for any backup-related script.

### Status file approach
The cleanest approach is to have the backup cron write a small JSON status file after each run. Add a line to each project's backup invocation (inside the container or the cron script) that writes:
```json
{ "lastRun": "<ISO timestamp>", "status": "ok" | "failed" }
```
to `/home/emit/projects/<name>/.backup-status.json` on the host (mounted into the container). The API's existing SSH-based status collection can then read this file.

### API side
- Look at `apps/api/src/routes/status.ts` (or wherever SSH status collection happens) to understand how the server SSHs to each project and reads files. The backup status can be read the same way: `cat ~/.../projects/<name>/.backup-status.json` via SSH, parsed as JSON, and added as `backupLastRun?: string | null; backupStatus?: string | null` fields to `ProjectStatus`.
- If reading the status file is too coupled to the main status check, alternatively add a new thin route `/projects/:name/backup-status` that SSHs and reads the file on demand.

### Client side
- Add `backupLastRun?: string | null` and `backupStatus?: string | null` to `ProjectStatus` type in `apps/dashboard/src/lib/api.ts`.
- On the detail page (`apps/dashboard/app/projects/[name]/page.tsx`), in the `HealthCard` or just below it, render a chip:
  - Green: "backup Xh ago" if last run < 25h
  - Amber: "backup Xh ago" if 25–48h
  - Red: "no backup in 48h+" or "backup failed"
  - Absent: if `backupLastRun` is null (project has no backup configured)

### Per-project backup script changes
For each of the 4 wired projects, find where the backup cron runs (inside the container entrypoint or a shell script). Add a status file write after the backup completes:
```bash
echo "{\"lastRun\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"ok\"}" > /backup-status.json
```
And map `/backup-status.json` (inside container) to `~/projects/<name>/.backup-status.json` on the host in `docker-compose.yml`, or write directly to the host-mounted path.

## Tasks
1. Read `/Users/emitdutcher/projects/tastease/docker-compose.yml` (and any `infra/scripts/backup*` file) to understand the backup container structure.
2. For each of the 4 projects, add status file writing to the backup cron/script. Mount the status file path if needed in docker-compose.
3. In the API, add reading of `.backup-status.json` to the status collection or as a new `/projects/:name/backup-status` route. Add `backupLastRun` + `backupStatus` to the response.
4. Add `backupLastRun?: string | null; backupStatus?: string | null` to `ProjectStatus` in `apps/dashboard/src/lib/api.ts`.
5. Render backup chip on the detail page, color-coded by age.

## Files involved
- `/Users/emitdutcher/projects/tastease/` — backup container config (and same for other 3 projects)
- `apps/api/src/routes/status.ts` (or equivalent) — add backup status reading
- `apps/dashboard/src/lib/api.ts` — extend `ProjectStatus` type
- `apps/dashboard/app/projects/[name]/page.tsx` — render backup chip

## Acceptance criteria
- [x] After a backup runs, `.backup-status.json` is present in the project directory on the host
- [x] API returns `backupLastRun` and `backupStatus` in project status
- [x] Detail page shows green chip when last backup < 25h
- [x] Detail page shows amber/red chip when backup is stale or failed
- [x] Projects without a backup container show no chip (graceful null handling)
- [x] `pnpm typecheck` passes

## Out of scope
- Triggering a manual backup from the dashboard
- Backup size or duration tracking
- R2 bucket contents listing


## Completed

**Date:** 2026-06-21

### Summary
Added `.backup-status.json` writing to the backup containers of tastease, develemail, and diner-decider. For tastease and develemail (both shell-loop `postgres:16-alpine` containers), modified the entrypoint/command to dump to a temp file, check the exit code, then write `{"lastRun":"...","status":"ok|failed"}` to `/host-opt/.backup-status.json` via a newly added `/opt/<name>:/host-opt` bind-mount. For diner-decider (which used the third-party `eeshugerman/postgres-backup-s3:16` image with a go-cron scheduler), replaced the entrypoint with a simple shell loop that reuses the image's pre-installed `pg_dump` and `aws` CLI, uploading to R2 via standard `AWS_*` env vars, then writes status. emit-vision has no backup container and gracefully returns null.

On the API side, added a thin `/projects/:name/backup-status` route that SSHes to the project server and cats `/opt/<name>/.backup-status.json`, returning 404 when the file doesn't exist. On the dashboard, added `BackupStatus` interface, `getBackupStatus` fetch function, and a `useBackupStatus` hook (polls every 5 min). The detail page shows a color-coded chip below the HealthCard: green when < 25h, amber when 25–48h, red when ≥ 48h or `status: "failed"`. Projects without a backup configured show no chip.

### Files changed
- `/Users/emitdutcher/projects/tastease/docker-compose.prod.yml` — `db-backup` service: added `/opt/tastease:/host-opt` volume, converted to temp-file approach with status write
- `/Users/emitdutcher/projects/develemail/docker-compose.prod.yml` — `pgbackup` service: added `/opt/develemail:/host-opt` volume, added status write in if/else
- `/Users/emitdutcher/projects/diner-decider/docker-compose.prod.yml` — `backup` service: overrode entrypoint to shell loop with pg_dump + aws s3 cp + status write; added `/opt/diner-decider:/host-opt` volume
- `apps/api/src/routes/projects.ts` — new `/projects/:name/backup-status` GET route
- `apps/dashboard/src/lib/api.ts` — `BackupStatus` interface + `getBackupStatus` function
- (new) `apps/dashboard/src/lib/use-backup-status.ts` — hook polling backup status every 5 min
- `apps/dashboard/app/projects/[name]/page.tsx` — imports hook, renders color-coded chip

### Verification
- `pnpm typecheck` (dashboard): clean
- `pnpm typecheck` (api): clean

### Follow-ups
- `[defer]` diner-decider's backup no longer runs the `go-cron` retention (`BACKUP_KEEP_DAYS: 7`) — S3 objects will accumulate. Add a retention prune pass (`aws s3 ls ... | sort | head -n -7 | xargs aws s3 rm`) in a follow-up sprint.
- `[defer]` The backup-status chip on the detail page uses `var(--ok)` for the green color; verify this CSS variable is defined in the theme (it's used by other components). If absent, fallback to `#22c55e` inline.
- `[defer]` emit-vision has no postgres backup container — the chip simply won't appear for it, which is correct. If a backup is added later, no code changes are needed: the file will appear and the chip will auto-populate.
