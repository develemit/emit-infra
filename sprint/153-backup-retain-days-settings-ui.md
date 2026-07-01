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

- [ ] Current `backupRetainDays` displayed as editable number input in BackupPanel
- [ ] Save writes the new value and refreshes the panel config
- [ ] Invalid values (non-integer, < 1, > 365) rejected by API with 400
- [ ] `pnpm nx typecheck api --skip-nx-cache && pnpm nx typecheck dashboard --skip-nx-cache` pass clean
