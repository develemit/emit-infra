# `emit-infra backup verify`: prove every backup restores
**Difficulty:** 4

## Goal
A new CLI command `emit-infra backup verify [name]`:
1. downloads the newest offsite dump for a project from R2;
2. restores it into a throwaway local Postgres container;
3. runs sanity checks;
4. tears the container down;
5. records the result.

Running it once per DB project proves that every backup in the fleet
actually restores, end to end.

## Reason
As of 2026-10-06 nobody had ever restored a fleet backup, and `pg_restore`
appeared nowhere in emit-infra. A backup that has never been restored is a
hypothesis. Formats vary across the fleet (`-Fc .dump` vs `.sql.gz`, see
`docs/BACKUP-INVENTORY.md` from sprint 359), so a format mismatch or
truncated dump is exactly the kind of thing only a real restore catches.

## Context
- **Depends on sprint 359.** Every DB project has an offsite R2 dump and a
  status file with `key`. `docs/BACKUP-INVENTORY.md` lists the bucket,
  prefix and format for each project. Read it first.
- **R2 credentials, read-only on the Mac:** use per-project credentials from
  `~/.emit-infra/<name>/` (e.g. `r2-backup-token.env`, created in 359), or
  the account-level token used by `r2-rotate-token`
  (`apps/cli/src/commands/r2-rotate-token.ts`). **Download on the Mac.**
  Never restore on a prod server.
- **Throwaway Postgres:**
  - `docker run --rm -d -p 127.0.0.1::5432 postgres:<major>-alpine`, with
    the image major matched to the dump's `pg_dump` version (`pg_restore -l`
    header, or the sidecar image tag);
  - discover the port with `docker port` (the fleet convention in
    `docs/EPHEMERAL-DEV-DB.md`; never a fixed port);
  - always remove the container, including on Ctrl-C (`try/finally` plus a
    SIGINT handler).
- **Restore:**
  - `.dump` → `pg_restore --no-owner --no-acl -d`;
  - `.sql.gz` → `gunzip | psql -v ON_ERROR_STOP=1`;
  - run the tools *inside* the container (`docker exec -i`) so local client
    version skew doesn't matter.
- **Sanity checks:**
  - restore exit code 0;
  - number of user tables > 0;
  - the 5 largest tables by row count printed;
  - optional per-project `backup.verifyQueries` in `.emit-infra.json`
    (zod-validated in `packages/types/src/project-config.ts`, next to
    `postgres.backupBucket`). Each is a SQL string that must return at least
    one row (e.g. `select 1 from users limit 1`).
- **ClickHouse (emit-vision):** out of scope for the automated drill. Do a
  manual restore check per `~/projects/emit-vision/docs/operations.md` if one
  exists, and record the result in the inventory doc. Otherwise note it as a
  gap.
- **Record results:** append JSONL to `~/.emit-infra/<name>/restore-drills.jsonl`
  as `{t, key, bytes, durationSec, tables, ok, error?}`. Optionally show the
  last drill on the dashboard's backup panel, but only if it's a small change
  (`apps/api/src/routes/project-backups.ts`).
- **CLI conventions:** commander, one file per command in
  `apps/cli/src/commands/`, registered like the others. Keep pure logic in
  `apps/cli/src/lib/`. `deploy.ts` (400 lines) is the cautionary tale: aim
  for ≤200 lines per file.

## Tasks
1. Add `backup.verifyQueries` to the project-config schema.
2. Write `apps/cli/src/lib/backup-verify.ts` with the pure parts:
   - choose the newest key from an `aws s3 ls` listing;
   - detect the format from the key;
   - build the restore commands;
   - parse table and row output.
3. Write `apps/cli/src/commands/backup-verify.ts` for the docker, aws and
   execa orchestration plus cleanup.
4. Run it against **every DB project** in the inventory. Fix what breaks: a
   failed restore is a finding. Report it to the user and add it to
   `BACKUP-INVENTORY.md`. Don't paper over it.
5. Add a `Last verified restore` column to `docs/BACKUP-INVENTORY.md`.
6. Add a monthly launchd job, `com.emit.restore-drill`, that runs verify for
   all DB projects. A failure goes through the API's `notify()` (sprint
   356). The simplest route is a `POST` to a new tiny API endpoint, or
   follow how `scripts/ghcr-prune.sh` reports. Pick one and say which.

## Files involved
- new: `apps/cli/src/commands/backup-verify.ts` (+ test)
- new: `apps/cli/src/lib/backup-verify.ts` (+ test)
- `apps/cli/src/index.ts` (or wherever commands register)
- `packages/types/src/project-config.ts`: `backup.verifyQueries`
- `docs/BACKUP-INVENTORY.md`
- new: launchd plist plus install note (follow how `com.emit.ghcr-prune` is
  installed)

## Acceptance criteria
- [ ] `apps/cli/src/lib/backup-verify.test.ts` covers:
  - newest-key selection, including keys from other prefixes being ignored;
  - format detection;
  - command construction for both formats;
  - parsing of table and row output.
- [ ] `backup-verify.test.ts` (command) covers that the container is removed
      on success, on restore failure and on thrown error, with execa mocked.
- [ ] Every DB project has a successful drill line in
      `restore-drills.jsonl`, and the date is recorded in the inventory doc.
      Any failure is reported to the user with its error.
- [ ] `pnpm build` was run so `apps/cli/dist` is current. `pnpm test`,
      `pnpm typecheck` and `pnpm lint` pass.

## Out of scope
- Restoring into production. That's a runbook step (sprint 362), not a
  command.
- Encrypted dumps (sprint 364 extends this command to decrypt).

### Approved by the user (2026-10-06, "approve all")
The production actions this sprint describes are approved. Proceed without asking again, with these exceptions where you must still stop for the user:
- confirming a real email arrived;
- any step that needs the user's password manager;
- any server **reboot**.

Guardrails:
- deploy sibling repos only through `~/projects/emit-infra/scripts/deploy-detached.sh --dir <repo>`;
- skip a repo whose tree is dirty or that has an active sprint loop (record it as deferred);
- before deploying a sibling repo, run `git log origin/main..HEAD --oneline`. If it carries **other people's unpushed commits that include DB migrations**, skip it and report. Otherwise proceed, and list the extra commits in Completed;
- Terraform: apply only plans that are in-place updates;
- SSH changes: one server at a time, with a second session held open.
