# Backup Completion Polling + Configurable Warn Thresholds
**Difficulty:** 3

## Goal
Show backup progress after triggering a manual backup, and allow per-project warn thresholds for disk/memory and backup age to be configured in project settings instead of being hardcoded.

## Reason
"Back up now" fires and disappears with no feedback — users have no way to know if the backup succeeded or is still running. Hardcoded 80%/24h/48h thresholds generate noise for projects with different normal operating ranges (e.g., a DB server that's always at 75% disk, or a dev project where a 5-day-old backup is fine).

## Context
- `apps/dashboard/src/components/detail/backup-panel.tsx` lines ~107–116: the trigger button calls the API and shows a brief flash. Instead, after triggering, enter a "running" polling state: call `GET /projects/:name/backup-status` every 5s until `status === 'complete'` or `status === 'failed'`. Show a spinner while polling. Show the final status when done.
- Hardcoded thresholds: disk/memory warn % is used in `apps/dashboard/app/projects/[name]/page.tsx` ~line 90 (or in health-card.tsx). Backup age thresholds are in `backup-panel.tsx`. Find the exact locations by reading those files.
- `packages/types/` — add `warnThresholds?: { diskPct?: number; memPct?: number; backupAgeHours?: number }` to `ProjectConfig`. Read the types file first to find the correct location and existing structure.
- Replace hardcoded values with `project.config.warnThresholds?.diskPct ?? 80`, `?.backupAgeHours ?? 24`, etc.
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — add a "Thresholds" section with numeric inputs for diskPct (default 80), memPct (default 80), and backupAgeHours (default 24).
- `apps/api/src/routes/projects.ts` — extend `PatchConfigBody` to accept `warnThresholds: { diskPct?, memPct?, backupAgeHours? }` in the PATCH handler.

## Tasks
1. Read `backup-panel.tsx`, `page.tsx` (or health-card.tsx), and the types package to locate hardcoded thresholds.
2. Add `warnThresholds` to `ProjectConfig` in `packages/types/`.
3. In `backup-panel.tsx`, add completion polling: after trigger fires successfully, poll `getBackupStatus` every 5s, show spinner, stop on complete/failed.
4. Replace hardcoded disk/memory thresholds with `project.config.warnThresholds?.diskPct ?? 80`.
5. Replace hardcoded backup age thresholds with `project.config.warnThresholds?.backupAgeHours ?? 24`.
6. In `project-settings-panel.tsx`, add a Thresholds section with three numeric inputs. Wire to the existing save pattern.
7. In `projects.ts`, extend `PatchConfigBody` to accept `warnThresholds`.
8. Typecheck.

## Files involved
- `packages/types/` (specific file TBD by reading) — add warnThresholds to ProjectConfig
- `apps/dashboard/src/components/detail/backup-panel.tsx` — add completion polling after trigger
- `apps/dashboard/app/projects/[name]/page.tsx` or `health-card.tsx` — use warnThresholds from config
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — add Thresholds section
- `apps/api/src/routes/projects.ts` — extend PatchConfigBody to accept warnThresholds

## Acceptance criteria
- [x] Triggering a backup shows a spinner/running state that polls until completion
- [x] Completion shows "Backup complete" or "Backup failed" message
- [x] Disk/memory warn threshold reads from `project.config.warnThresholds?.diskPct` with fallback to 80
- [x] Backup age threshold reads from `project.config.warnThresholds?.backupAgeHours` with fallback to 24
- [x] Threshold fields are editable in project Settings and save via PATCH
- [x] Typecheck passes

## Out of scope
- WebSocket or SSE for backup progress (polling every 5s is sufficient)
- Threshold validation beyond basic numeric range (>0, ≤100 for pct)
- Per-project polling intervals

## Completed

**Date:** 2026-07-02

### Summary
Added `warnThresholds` (diskPct, memPct, backupAgeHours) to `ProjectConfig` and the PATCH endpoint, wired them through `ProjectConfigPatch` in the dashboard type, and updated `deriveHealth` to accept an optional thresholds parameter (defaulting to 80/80). Both `use-project-detail.ts` and `project-card.tsx` now pass the project's thresholds to `deriveHealth`. A Thresholds section was added to `ProjectSettingsPanel` with three numeric inputs. Backup completion polling was added to `BackupPanel`: after `handleTriggerBackup()` fires, a 5s `setInterval` polls `getBackupStatus` until `lastRun` is newer than the trigger timestamp, then shows "Backup complete" or "Backup failed" in the button. A stale-backup warning appears when the newest backup is older than `backupAgeHours` hours.

### Files changed
- `packages/types/src/project-config.ts` — added `warnThresholds` schema field
- `apps/api/src/routes/projects.ts` — extended `PatchConfigBody` with `warnThresholds`
- `apps/dashboard/src/lib/api-projects.ts` — added `warnThresholds` to `ProjectConfigPatch`
- `apps/dashboard/src/lib/health.ts` — updated `deriveHealth` to accept optional thresholds
- `apps/dashboard/src/lib/use-project-detail.ts` — passes `project?.config.warnThresholds` to `deriveHealth`
- `apps/dashboard/src/components/project-card.tsx` — passes `project.config.warnThresholds` to `deriveHealth`
- `apps/dashboard/src/components/detail/backup-panel.tsx` — added completion polling, stale-backup warning
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — added Thresholds section

### Verification
- `npx nx test api`: 106/106 pass
- typecheck: clean across all 5 packages

### Follow-ups
- `[defer]` Backup completion polling has no UI progress indicator beyond "Running…" — a time-elapsed counter would improve perceived responsiveness
- `[defer]` The 10-minute polling timeout silently stops without user feedback — could show "Backup status unknown — check logs" on timeout
