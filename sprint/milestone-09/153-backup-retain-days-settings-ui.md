# Sprint 153 — Backup retention days settings UI

> _Promoted from sprint-128 follow-up, 2026-07-01._

**Difficulty:** 3

## Goal

Add a settings control to the BackupPanel that lets users view and update `backupRetainDays` for a project without editing `.emit-infra.json` by hand.

## Context

- `backupRetainDays` lives in `project.config.postgres.backupRetainDays` (a `z.number().int().min(1).default(7)` field added in sprint-128).
- There's likely a project settings API or patch endpoint. Check `apps/api/src/routes/projects.ts` for a PATCH or PUT route for project config. If none exists, this sprint also needs to add a minimal `PATCH /projects/:name/config` route that accepts `{ postgres: { backupRetainDays: number } }` and writes it to the `.emit-infra.json` file.
- Dashboard: add a small inline edit control to the BackupPanel footer — a number input field (min 1, max 365) showing the current value, with a "Save" button. On success, re-read the project config.
- This is not a full settings page — just the single field exposed inside the panel that owns it.

## Tasks

1. Read `apps/api/src/routes/projects.ts` to check if a PATCH config route exists.
2. If no patch route: add `PATCH /projects/:name/config` that accepts a partial config update, merges it into the current `.emit-infra.json`, and writes it back. Validate `backupRetainDays` with Zod (must be integer 1–365).
3. Add `updateBackupRetainDays(name, days)` to `apps/dashboard/src/lib/api.ts`.
4. Add the inline number input + Save button to `BackupPanel` footer.
5. Run `pnpm nx typecheck api --skip-nx-cache && pnpm nx typecheck dashboard --skip-nx-cache`.

## Acceptance criteria

- [x] Current `backupRetainDays` displayed as editable number input in BackupPanel
- [x] Save writes the new value and refreshes the panel config
- [x] Invalid values (non-integer, < 1, > 365) rejected by API with 400
- [x] `pnpm nx typecheck api --skip-nx-cache && pnpm nx typecheck dashboard --skip-nx-cache` pass clean

## Completed

**Date:** 2026-07-01

### Summary
Added `PATCH /projects/:name/config` to the API, which reads the current `.emit-infra.json`, deep-merges the incoming `postgres` partial (validated via Zod: `backupRetainDays` must be integer 1–365), and writes it back. The route returns 400 on invalid input and 404 if the project doesn't exist.

Added `updateBackupRetainDays(name, days)` to the dashboard `api.ts`. Updated `BackupPanel` with a footer row: a number input (min=1, max=365) pre-filled from `project.config.postgres?.backupRetainDays ?? 7`, a Save button that calls the API, and an inline error span that shows if the save fails.

Also fixed a latent type error in `backup.test.ts` where the mock postgres config was missing the required `version` field — adding `version: '16'` matched the schema default.

### Files changed
- `apps/api/src/routes/projects.ts` — added `z` import and `PATCH /projects/:name/config` route
- `apps/dashboard/src/lib/api.ts` — added `updateBackupRetainDays`
- `apps/dashboard/src/components/detail/backup-panel.tsx` — retention days footer with number input + Save button
- `apps/api/src/routes/backup.test.ts` — fixed mock postgres missing `version` field

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx test api --skip-nx-cache`: 54/54 pass

### Follow-ups
- none
