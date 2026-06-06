# Install postgres-backup script at provision time
**Difficulty:** 2

## Goal
Add the `postgres-backup` Ansible role to `provision.yml` (conditionally, when
`postgres_backup_bucket` is defined) so the backup script and cron job exist on
the server from day one — not waiting for the first deploy to install them.

## Reason
The backup cron runs at 2 AM every day. Currently the backup script is only
installed when `deploy.yml` runs for the first time. A freshly provisioned server
with R2 credentials in `.env` (via sprint 20) but no completed deploy has no
backup script — the 2 AM window is silently missed. Moving script installation
to provision time closes that gap: credentials arrive during provision (sprint 20),
script arrives during provision (this sprint), and the first backup fires on schedule.

## Context
- `ansible/playbooks/provision.yml` currently runs `common`, `docker`, `nginx`.
  Add `postgres-backup` conditionally at the end.
- `ansible/playbooks/deploy.yml` already has the postgres-backup role with
  `when: postgres_backup_bucket is defined and postgres_backup_bucket | length > 0`.
  Copy the same pattern — keep it in deploy.yml too (idempotent Ansible tasks
  handle re-runs fine).
- `ansible/roles/postgres-backup/tasks/main.yml` — installs `awscli`, writes
  the db-backup shell script from `db-backup.sh.j2`, schedules cron. All three
  tasks are safe to run at provision time (script installation only, no DB
  connection required; the script sources `.env` at runtime).
- `ansible/roles/postgres-backup/templates/db-backup.sh.j2` uses these vars:
  - `project_name` — already in provision ansibleVars
  - `app_dir` — already in provision ansibleVars
  - `postgres_backup_bucket` — must be added when present
  - `compose_file` — defaults to `docker-compose.prod.yml` in the template
- In `apps/cli/src/commands/setup.ts`, `ansibleVars` is built just before the
  `runAnsible('provision', ...)` call. Add `postgres_backup_bucket` there when
  `config.postgres?.backupBucket` is set.

## Tasks

1. In `ansible/playbooks/provision.yml`, add the `postgres-backup` role at the
   end of the roles list, with the same condition as `deploy.yml`:
   ```yaml
   - role: postgres-backup
     when: postgres_backup_bucket is defined and postgres_backup_bucket | length > 0
   ```

2. In `apps/cli/src/commands/setup.ts`, inside the `ansibleVars` block (just
   before `runAnsible('provision', ...)`), add:
   ```ts
   if (config.postgres?.backupBucket) {
     ansibleVars.postgres_backup_bucket = config.postgres.backupBucket
   }
   ```

3. Optionally pass `compose_file` if `config.deploy?.composeDest` is set — the
   template defaults sensibly so this is only needed for non-standard compose file
   names. Check if `compose_file` is already being passed (it is, conditionally).
   The postgres-backup template uses `compose_file` with a default, so no change
   needed there.

4. Run `pnpm tsc --noEmit -p apps/cli/tsconfig.json` — confirm clean.

## Files involved

- `ansible/playbooks/provision.yml` — add postgres-backup role at end
- `apps/cli/src/commands/setup.ts` — add postgres_backup_bucket to ansibleVars

## Acceptance criteria

- [x] `provision.yml` includes the `postgres-backup` role when `postgres_backup_bucket` is defined
- [x] `provision.yml` skips `postgres-backup` when `postgres_backup_bucket` is not defined (no errors)
- [x] `setup.ts` passes `postgres_backup_bucket` to Ansible vars when `config.postgres.backupBucket` is set
- [x] TypeScript compiles clean

## Completed

**Date:** 2026-06-06

### Summary
Added the `postgres-backup` role to `provision.yml` with the same conditional
guard used in `deploy.yml` (`when: postgres_backup_bucket is defined and
postgres_backup_bucket | length > 0`). In `setup.ts`, `postgres_backup_bucket`
is now passed into `ansibleVars` when `config.postgres.backupBucket` is set,
positioned after the `r2_credentials` block. The `compose_file` variable was
already being passed conditionally, so no additional change was needed there.

### Files changed
- `ansible/playbooks/provision.yml` — added postgres-backup role at end of roles list with conditional
- `apps/cli/src/commands/setup.ts` — added postgres_backup_bucket to ansibleVars when configured

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean (no output)
- code review: `when:` guard matches deploy.yml pattern exactly
- code review: no-backup-config path leaves var undefined, role is skipped

### Follow-ups
- `[defer]` Consider adding a health-check for the backup cron (e.g. a monitoring endpoint that reports last successful backup time)

## Out of scope

- Any changes to the backup script itself
- Removing the role from `deploy.yml` (keep it there for idempotency)
