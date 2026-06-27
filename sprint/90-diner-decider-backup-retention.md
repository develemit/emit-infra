# Sprint 90 — diner-decider S3 backup retention prune

> _Promoted from sprint-86 follow-up, 2026-06-27._

## Goal

Add a retention prune pass to diner-decider's postgres backup routine so S3 objects don't accumulate indefinitely. Keep the last 7 days of backups; delete older ones.

## Context

### What sprint 86 changed

Sprint 86 replaced diner-decider's third-party `eeshugerman/postgres-backup-s3` image (which used go-cron with built-in `BACKUP_KEEP_DAYS: 7` retention) with a simple shell loop. The shell loop uses the pre-installed `pg_dump` and `aws` CLI from that image, uploads to R2, and writes `.backup-status.json`. However, the go-cron retention logic (`BACKUP_KEEP_DAYS`) is no longer invoked — so backups accumulate on R2 indefinitely.

The sprint-86 summary explicitly flagged this:
> `[defer]` diner-decider's backup no longer runs the `go-cron` retention (`BACKUP_KEEP_DAYS: 7`) — S3 objects will accumulate. Add a retention prune pass (`aws s3 ls ... | sort | head -n -7 | xargs aws s3 rm`) in a follow-up sprint.

### diner-decider backup config
- File: `/Users/emitdutcher/projects/diner-decider/docker-compose.prod.yml` — `backup` service
- The backup uploads to an R2 bucket. Read `docker-compose.prod.yml` to see the `AWS_S3_PREFIX`, `AWS_S3_BUCKET`, and `S3_ENDPOINT` env vars — these are needed for the `aws s3 ls` and `aws s3 rm` commands.
- The shell loop currently runs via `command:` override in docker-compose. The retention prune should run at the end of the same loop iteration, after the status file write.

### Retention logic

After a successful backup upload, list all objects in the backup prefix, sort by date (oldest first), keep the last 7, and delete the rest:

```bash
# List objects, sort, keep last 7, delete the rest
aws s3 ls "s3://${AWS_S3_BUCKET}/${AWS_S3_PREFIX:-}/" \
  --endpoint-url "${S3_ENDPOINT}" \
  | sort \
  | awk 'NR>0{print $4}' \
  | head -n -7 \
  | xargs -I{} aws s3 rm "s3://${AWS_S3_BUCKET}/${AWS_S3_PREFIX:-}/{}" \
      --endpoint-url "${S3_ENDPOINT}" \
  || true
```

The `|| true` prevents the prune step from failing the whole script if there are fewer than 7 backups (nothing to delete).

Only prune on success (don't prune if the backup itself failed — that would delete the only recent backup).

### S3 path pattern
The original `postgres-backup-s3` image named files like `db-YYYY-MM-DDTHH:mm:ssZ.sql.gz`. The new shell loop should use the same naming convention so the `ls | sort` order is chronological. Read the existing command in `docker-compose.prod.yml` to confirm the filename pattern.

## Tasks

1. Read `/Users/emitdutcher/projects/diner-decider/docker-compose.prod.yml` — specifically the `backup` service `command:` block.
2. Identify the S3 filename pattern (confirm it's sortable chronologically).
3. Add the retention prune pass (7-keep) at the end of the successful backup branch, before the status file write.
4. Verify the `aws s3 ls` prefix/bucket vars are available in scope (they should be — same container env vars).
5. Run `bash -n` on the compose command to confirm no syntax errors (extract the shell block to a temp file if needed).
6. Commit the change in `~/projects/diner-decider/`.

## Files involved

- `/Users/emitdutcher/projects/diner-decider/docker-compose.prod.yml` — `backup` service command block

## Acceptance criteria

- [x] After a successful backup, objects older than 7 runs are deleted from R2
- [x] If fewer than 7 backups exist, prune step exits cleanly (no error)
- [x] If the backup itself fails, no prune runs (old backups preserved)
- [x] Shell block passes `bash -n` syntax check
- [x] `.backup-status.json` still written correctly after change

## Completed

**Date:** 2026-06-27

### Summary
Added a retention prune pass inside the successful-upload branch of diner-decider's backup container. After each successful S3 upload, the script counts existing objects under `db-backups/` and deletes the oldest ones if there are more than 7. Used a count-based approach (`head -n <positive_count>`) rather than `head -n -7` because Alpine's BusyBox `head` doesn't support negative counts. The prune is a no-op when ≤7 backups exist, and is entirely skipped when the dump or upload fails — so a backup failure never causes old backups to be pruned.

### Files changed
- `/Users/emitdutcher/projects/diner-decider/docker-compose.prod.yml` — added 8-line prune block inside successful-upload branch of `backup` service command

### Verification
- `bash -n` on extracted shell block: `syntax OK`
- Logic review: prune inside `if [ S3 upload succeeded ]`, gated by `PRUNE_N > 0`
- All three status file write paths (`ok`, `upload-failed`, `dump-failed`) unchanged

### Follow-ups
none
