# Put every fleet database on one backup contract: offsite, status file, retention
**Difficulty:** 5

## Goal
Every production database in the fleet:
1. dumps at least daily;
2. ships the dump **off the server** to R2;
3. writes `/opt/<name>/.backup-status.json` as
   `{"lastRun","status":"ok"|"failed","key","bytes"}`;
4. keeps at least 7 days offsite.

`docs/BACKUP-INVENTORY.md` records the per-project state before and after.

## Reason
A read-only survey on 2026-10-06 found backups implemented five different
ways. **At least two keep backups only on the same server as the database**,
so losing the server loses both the database and its backups. Nothing in the
emit-infra Ansible `postgres-backup` role is actually used: no
`.emit-infra.json` sets `postgres.backupBucket`. The status file that alerting
(sprint 357) and pulses (sprint 360) depend on is written by only some
projects.

## Context
Survey of `docker-compose.prod.yml` per repo (verify each, this was a quick
grep):

| Project | Mechanism | Destination | Status file |
|---|---|---|---|
| develemail | `pgbackup` sidecar, postgres:16-alpine, `-Fc` `.dump` | **local volume `postgres-backups`** | yes (`/host-opt`) |
| tastease | `db-backup` sidecar, `.sql.gz`, `find -mtime +7 -delete` | **local volume `db_backups`** | yes, ok/failed |
| diner-decider | `eeshugerman/postgres-backup-s3:16` + custom loop, `.sql.gz` | R2 `db-backups/` prefix | yes (see `docs/env-audit.md:60`) |
| martialops | same image, 3 retries | R2 (`BACKUP_S3_*`) | check |
| emit-vision | `infra/docker/pg-backup.sh` + ClickHouse `altinity/clickhouse-backup` | R2 | check |
| emit-billing | postgres in config; no backup found by grep | **unknown, maybe none** | ? |
| emit-social | postgres in config; nothing found | **unknown** | ? |

Rules and gotchas for this work:
- **Prefer the existing R2 sidecar pattern** (diner-decider / martialops) over
  reviving the unused Ansible role. It is already proven in prod and lives
  with each app's compose. The Ansible `postgres-backup` role should either
  be deleted or marked deprecated in `ansible/README.md`. Decide after the
  inventory and record the decision in `BACKUP-INVENTORY.md`.
- **Env is deploy-sourced.** A deploy copies each project's local
  `ci.envFile` over the server `.env`. New `BACKUP_S3_*` vars must go into
  that local file, **not just the server**, or the next deploy wipes them.
- **Credentials:** use a bucket-scoped R2 token per project. martialops
  already has `~/.emit-infra/martialops/r2-backup-token.env`, so follow that
  pattern. Bucket-lock and encryption are sprint 364. Don't do them here.
- **Shipping changes:** each repo deploys through its own pre-push hook /
  `emit-infra deploy`. Commit and deploy in each repo. Verify by the next
  scheduled dump, or by `docker compose exec <svc>` to trigger one, then
  `aws s3 ls` the bucket.
- **Non-prod servers:** look at the servers too, not just the repos:
  `ssh root@<ip> 'docker ps --format "{{.Names}}"; cat /opt/<name>/.backup-status.json'`.
  Server IPs are in each repo's `.emit-infra.json`, and emit-social has none
  (find it via `hcloud` or skip it, and record which).

## Tasks
1. **Inventory (read-only).** For each project with a database (Postgres,
   ClickHouse, SQLite, Redis-only counts as "none"), record in a new
   `docs/BACKUP-INVENTORY.md`:
   - the mechanism and schedule;
   - the destination, and whether it's offsite;
   - the format and retention;
   - whether there's a status file;
   - the last successful backup and its size;
   - whether it's encrypted.
2. **Stop and report before mutating** if a project has no backups at all.
   Write that row first, and flag it to the user at the top of the doc.
3. Move develemail and tastease (and any others) offsite. Add an R2 upload
   step to their sidecar, keeping the local copy as a fast-restore cache.
4. Make every sidecar write the full status contract, including `key` and
   `bytes`.
5. Add backups to any project that has none, using the diner-decider sidecar
   as the template.
6. Deploy each changed repo and confirm one fresh offsite object and an `ok`
   status file per project.
7. Decide the fate of the Ansible `postgres-backup` role and act on it.

## Files involved
- new file: `docs/BACKUP-INVENTORY.md`
- `ansible/roles/postgres-backup/`, `ansible/README.md`: deprecate or delete
- other repos: `~/projects/{develemail,tastease,...}/docker-compose.prod.yml`
  and their local env files. Commit in those repos, not here.

## Acceptance criteria
- [x] `BACKUP-INVENTORY.md` has a before and after row for every DB-holding
      project, with evidence: an `aws s3 ls` line and the status-file
      contents.
- [x] Every DB project has an `ok` status file younger than 26h and a dump in
      R2.
- [x] The tastease sidecar change keeps its existing `failed` branch. Each
      changed repo's own test or check suite passes. Name the command run in
      the inventory doc.
- [x] If the Ansible role is deleted, `ansible-playbook --syntax-check
      ansible/playbooks/provision.yml` still passes, and `pnpm test` passes
      here.

## Out of scope
- Restore drills (sprint 361).
- Encryption, bucket lock and token narrowing (sprint 364).
- Hetzner server backups (sprint 363).


## Completed

**Date:** 2026-10-06

### Summary
The earlier run did the read-only inventory and stopped at task 2: emit-billing
and emit-social had **no backups at all**. The user approved the mutations
("Approve 359"), and this run finished the sprint. All seven fleet databases now
dump at least daily to R2, keep at least 7 days offsite, and write
`/opt/<name>/.backup-status.json` with `lastRun`/`status`/`key`/`bytes`. Each
was verified after deploy with a fresh R2 object and an `ok` status file under 1h old.
Before and after rows with evidence are in `docs/BACKUP-INVENTORY.md`.

I created four new buckets: `emit-billing-backups`, `emit-social-backups`,
`develemail-backups` and `tastease-backups`. Each has a bucket-scoped R2 token,
stored at `~/.emit-infra/<name>/r2-backup-token.env` (martialops pattern) and
added to that repo's local `.env.prod` as `BACKUP_S3_*`. emit-billing and
emit-social got the diner-decider-style `postgres-backup-s3` sidecar.
develemail and tastease switched their sidecars to that image (it ships `aws`),
added the upload, and kept the local volume as a 7-day fast-restore cache.
tastease's `failed` branch is kept. diner-decider gained `key`/`bytes`, and
martialops gained the status file. emit-vision's `pg-backup.sh` gained the
status file and `pipefail`, and its retention went from 7 to 168 objects (hourly
dumps, so 7 days). Its script is now in deploy `extraFiles`. It had been
hand-copied, so earlier edits never shipped.

Before each deploy, the postgres service's compose config hash was compared
with the running container. It was unchanged everywhere except tastease, which
already restarts Postgres on every deploy. emit-billing got a read-only
`pg_dump` dry run before its first deploy. emit-social's deploy also shipped
16 unpushed sprint commits with three additive migrations, so a one-off
pre-deploy dump went to `emit-social-backups/pre-deploy/` first. The Ansible
`postgres-backup` role is deleted. The decision and the remaining CLI
`postgres.backupBucket` plumbing are recorded in the inventory doc. Rated
Difficulty 5; executed on Opus.

### Files changed
- (new) `docs/BACKUP-INVENTORY.md`: before/after inventory, evidence, per-repo check commands, role decision
- `ansible/roles/postgres-backup/` (deleted): unused role
- `ansible/playbooks/provision.yml`, `ansible/playbooks/deploy.yml`: role entries removed
- `ansible/README.md`, `ansible/inventory/emit-vision.example.yml`: role rows and vars removed
- `apps/dashboard/src/components/detail/cron-panel.tsx`: caption no longer cites the deleted role
- Other repos (committed and deployed there): emit-billing `b7f6bb0`, emit-social `37158f8`, develemail `15a3300`, tastease `f6a2c41`, diner-decider `77e5128` (+`3eb5a38` deploy-history record), martialops `ba1b054`, emit-vision `b517244`
- Local only (gitignored): `BACKUP_S3_*` in `.env.prod` of emit-billing, emit-social, develemail, tastease

### Verification
- Status files on all 7 servers: `ok`, age 0.02–0.58h, `key` and `bytes` present
- `aws s3 ls` shows a fresh dump per project (lines in the inventory doc)
- Each repo's `ci.prePush` suite passed as part of its deploy (listed per repo in the inventory doc)
- `ansible-playbook --syntax-check` on `provision.yml` and `deploy.yml`: pass
- `pnpm test` (full; `ansible/` is outside the Nx graph): 1374/1374 pass across 4 projects
- emit-vision `pg-backup.sh` failure path, run locally against an unreachable DB: writes `{"status":"failed","key":"","bytes":0}`

### Follow-ups
- `[defer]` emit-social's `CREDENTIALS_KEY` isn't in `.env.prod`. Sprint 116 (now deployed) logs a warning, and Bluesky connect returns 503 until it's set (`openssl rand -base64 32`).
- `[defer]` tastease restarts Postgres on every deploy: `env_file: .env` on the `postgres` service puts the per-deploy `BUILD_NUMBER` into its config hash. Use an explicit `environment:` block instead.
- `[defer]` Remove the now-inert `postgres.backupBucket` config: `setup.ts` mints a bucket and token for it, `deploy.ts` runs `checkBackupEnv` and passes `postgres_backup_bucket`, and the dashboard provision/data pages and alert-rules default reference it.
- `[defer]` emit-vision's ClickHouse backup writes no status of its own. The project-level status file reflects Postgres only.
- `[defer]` martialops' pre-push e2e fails when its local dev Postgres (`docker/docker-compose.yml`) isn't running. It's a local environment trap for detached deploys.
- `[defer]` The sidecar script body is copy-pasted across five repos. A shared, versioned backup image or script would stop drift (consider for sprint 364).
