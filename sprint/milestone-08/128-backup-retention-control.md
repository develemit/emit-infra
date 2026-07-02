# Sprint 128 — Backup retention control

**Difficulty:** 2

## Goal

Expose the backup script's hard-coded `KEEP=7` as a per-project config field `postgres.backupRetainDays`, so different projects can keep different retention windows without editing bash scripts.

## Reason

The current `KEEP=7` in `db-backup.sh.j2` is invisible to project config and impossible to change without SSHing into the server and editing a managed file. A project doing hourly writes may want 14 days; a staging environment may want 3. This is a three-file change: schema → ansible → deploy vars wiring.

## Context

- `packages/types/src/project-config.ts` — the canonical Zod schema (`ProjectConfigSchema`). Add `backupRetainDays` to the `postgres` object. Default to `7` to match current behaviour.
- `ansible/roles/postgres-backup/templates/db-backup.sh.j2` — change `KEEP=7` on the line after the timestamp declaration to `KEEP={{ postgres_backup_retain_days | default(7) }}`.
- `apps/api/src/routes/operations.ts` — the deploy route already passes `postgres_backup_bucket` as an ansible extra-var when `project.config.postgres.backupBucket` is set (around line 46). Add `postgres_backup_retain_days` in the same block when `project.config.postgres.backupRetainDays` is set.
- `packages/core/src/r2.ts` — not touched.
- After this sprint, re-provisioning or deploying a project will bake the correct retention into the backup script. Existing scripts on live servers are NOT retroactively updated — that happens on next provision/deploy.

### Exact schema addition

In `packages/types/src/project-config.ts`, the `postgres` object currently is:
```ts
postgres: z.object({
  version: z.string().default('16'),
  backupBucket: z.string().optional(),
}).optional(),
```

Change to:
```ts
postgres: z.object({
  version: z.string().default('16'),
  backupBucket: z.string().optional(),
  backupRetainDays: z.number().int().min(1).default(7),
}).optional(),
```

### Exact operations.ts addition

After the existing `deployVars['postgres_backup_bucket'] = ...` line, add:
```ts
deployVars['postgres_backup_retain_days'] = project.config.postgres.backupRetainDays ?? 7
```

(The `?? 7` is belt-and-suspenders; Zod default already guarantees the value.)

### Exact template change

In `ansible/roles/postgres-backup/templates/db-backup.sh.j2`, find:
```bash
KEEP=7
```
Replace with:
```bash
KEEP={{ postgres_backup_retain_days | default(7) }}
```

## Tasks

1. Read `packages/types/src/project-config.ts` to confirm the exact current shape of the `postgres` object before editing.
2. Add `backupRetainDays` to the `postgres` Zod object in `project-config.ts`.
3. Read `ansible/roles/postgres-backup/templates/db-backup.sh.j2` to find the `KEEP=7` line and replace it.
4. Read `apps/api/src/routes/operations.ts` lines 40–55 to find the exact insertion point, then add the `postgres_backup_retain_days` deploy var.
5. Run `pnpm nx typecheck api types --skip-nx-cache`. Fix any errors.

## Files involved

- `packages/types/src/project-config.ts` — add `backupRetainDays` to postgres object
- `ansible/roles/postgres-backup/templates/db-backup.sh.j2` — parameterise KEEP
- `apps/api/src/routes/operations.ts` — pass retain days as deploy extra-var

## Acceptance criteria

- [x] `ProjectConfigSchema.postgres.backupRetainDays` is a `z.number().int().min(1)` with default `7`
- [x] `db-backup.sh.j2` uses `{{ postgres_backup_retain_days | default(7) }}` instead of `7`
- [x] `operations.ts` passes `postgres_backup_retain_days` in `deployVars` when postgres config is present
- [x] `pnpm nx typecheck api types --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Three-file change exposing `KEEP=7` as a configurable field. Added `backupRetainDays: z.number().int().min(1).default(7)` to the postgres Zod schema in `project-config.ts` (default preserves existing behaviour). Changed the Jinja2 template to `KEEP={{ postgres_backup_retain_days | default(7) }}` so the ansible role accepts the value. Added `deployVars['postgres_backup_retain_days'] = project.config.postgres.backupRetainDays ?? 7` in operations.ts immediately after the existing `postgres_backup_bucket` var.

### Files changed
- `packages/types/src/project-config.ts` — `backupRetainDays` added to postgres schema
- `ansible/roles/postgres-backup/templates/db-backup.sh.j2` — `KEEP` parameterised via Jinja2
- `apps/api/src/routes/operations.ts` — `postgres_backup_retain_days` extra-var in deploy route

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck types --skip-nx-cache`: clean

### Follow-ups
- `[defer]` Dashboard UI for editing `backupRetainDays` per project (settings panel sprint, out of scope here)

## Out of scope

- Dashboard UI to edit `backupRetainDays` (can be done in a settings panel sprint later)
- Retroactively re-running provision on live servers (ops concern, not this sprint)
- Validating that retainDays ≤ some maximum
