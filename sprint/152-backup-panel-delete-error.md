# Sprint 152 — BackupPanel inline delete error feedback

> _Promoted from sprint-126 follow-up, 2026-07-01._

**Difficulty:** 2

## Goal

When a backup delete fails, show an inline error message below the failing row instead of silently re-fetching.

## Context

- `apps/dashboard/src/lib/use-backups.ts` contains `deleteBackup(key)` which currently calls the API and then calls `fetchBackups()` on both success and failure — swallowing the error silently.
- `apps/dashboard/src/components/detail/backup-panel.tsx` renders the backup list from `useBackups`.
- Add a `deleteError` field to `useBackups` state (or accept a per-key error map). On API error, set the error string rather than re-fetching. Clear it on next delete attempt or manual refresh.
- Render the error inline in `BackupPanel` below the row that failed: a small red text like "Delete failed — check server logs". Don't replace the whole panel with an error.

## Tasks

1. Read `apps/dashboard/src/lib/use-backups.ts` in full to understand current delete logic.
2. Read `apps/dashboard/src/components/detail/backup-panel.tsx` to understand current row rendering.
3. Add `deleteError: string | null` to `useBackups` state. Set it on API error; clear on refresh or new delete attempt.
4. Render the error message inline in `BackupPanel` near the row that triggered it (or as a generic panel-level error if per-row tracking is too complex).
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Acceptance criteria

- [ ] Delete API failure sets `deleteError` and renders a visible error message
- [ ] Success clears any existing error
- [ ] Manual refresh (Refresh button) clears the error
- [ ] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean
