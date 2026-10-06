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
- [ ] `BACKUP-INVENTORY.md` has a before and after row for every DB-holding
      project, with evidence: an `aws s3 ls` line and the status-file
      contents.
- [ ] Every DB project has an `ok` status file younger than 26h and a dump in
      R2.
- [ ] The tastease sidecar change keeps its existing `failed` branch. Each
      changed repo's own test or check suite passes. Name the command run in
      the inventory doc.
- [ ] If the Ansible role is deleted, `ansible-playbook --syntax-check
      ansible/playbooks/provision.yml` still passes, and `pnpm test` passes
      here.

## Out of scope
- Restore drills (sprint 361).
- Encryption, bucket lock and token narrowing (sprint 364).
- Hetzner server backups (sprint 363).
