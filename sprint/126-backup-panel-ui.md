# Sprint 126 — Backup panel UI

**Difficulty:** 3

## Goal

Add a backup management panel to the project detail page: a table of existing dumps with size and age, per-row delete (with inline confirmation) and download buttons, and a "Back up now" trigger button.

## Reason

Sprint 125 added the API surface. This sprint makes it usable — closing the main request for storage management and on-demand backups without leaving the dashboard.

## Context

- `apps/dashboard/src/lib/api.ts` — add four new API client functions: `listBackups`, `deleteBackup`, `triggerBackup`, `getBackupDownloadUrl`. Match the existing function style (fetch + authHeaders + error handling).
- `apps/dashboard/src/lib/use-backup-status.ts` — existing hook for last-run/pass-fail chip; leave it alone. The new `use-backups.ts` hook manages the list separately.
- `apps/dashboard/src/lib/use-project-detail.ts` — add `const backups = useBackups(name)` and include it in the returned object.
- The consuming component that renders `backupStatus` (returned from `useProjectDetail`) is the project detail shell. Grep for `backupStatus` in `src/components/` to find it. Mount `<BackupPanel>` below the health card, only when `project.config.postgres?.backupBucket` is set.
- `apps/dashboard/src/components/detail/health-card.tsx` — reference for the card layout pattern (`rounded-xl border border-border bg-card`, padding 18, header row with Icon + label).
- `apps/dashboard/src/components/detail/container-row.tsx` — reference for inline confirm pattern (local `confirmId` state, click once to arm, click again to confirm).
- `apps/dashboard/src/components/ui/badge.tsx` — Badge component for status chips.

### BackupObject type (from sprint 125)

```ts
interface BackupObject {
  key: string          // e.g. "tastease_20260628_020010.dump"
  sizeBytes: number
  lastModified: string // ISO string
}
```

### API functions to add to api.ts

```ts
export async function listBackups(name: string): Promise<BackupObject[]>
export async function deleteBackup(name: string, key: string): Promise<{ ok: boolean }>
export async function triggerBackup(name: string): Promise<{ ok: boolean; output: string }>
export async function getBackupDownloadUrl(name: string, key: string): Promise<string>
// getBackupDownloadUrl fetches GET /projects/:name/backups/:key/download and returns body.url
```

### use-backups.ts hook shape

```ts
export function useBackups(name: string) {
  // state: backups list, loading, triggering, error
  // fetchBackups(): refetch list
  // deleteBackup(key): optimistic remove → API call → refetch on success
  // triggerBackup(): set triggering=true → API call → refetch → triggering=false
  // downloadBackup(key): call getBackupDownloadUrl → window.open(url, '_blank')
  return { backups, loading, triggering, error, fetchBackups, deleteBackup, triggerBackup, downloadBackup }
}
```

### BackupPanel layout sketch

```
┌─ Backups ──────────────────────────────── [Back up now ▶] ─┐
│ tastease_20260629_020008.dump   4.7 MB   1d ago  [↓] [🗑]  │
│ tastease_20260628_020010.dump   4.6 MB   2d ago  [↓] [🗑]  │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

- Format sizeBytes as human-readable (e.g. `4.7 MB`) — implement a local `formatBytes(n)` helper.
- Format lastModified as age (e.g. `1d ago`, `3h ago`) — same helper pattern as `deployedAgo` in health-card.tsx.
- Delete: first click shows "Confirm?" text on the button; second click executes. Use a `confirmKey` state string (set to `key` on first click, null otherwise). Cancel on blur or if a different row is clicked.
- Download: calls `downloadBackup(key)` which opens the presigned URL in a new tab.
- "Back up now": disabled + spinner while `triggering === true`.
- If `backups` is empty and not loading: show a dim "No backups found" message.
- Only render the panel when `project?.config.postgres?.backupBucket` is set.

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 30 lines) to confirm the existing function style before adding new ones.
2. Add `BackupObject` interface and four API functions to `api.ts`.
3. Create `apps/dashboard/src/lib/use-backups.ts` with the hook described above.
4. Create `apps/dashboard/src/components/detail/backup-panel.tsx` — the panel component. Keep it under 200 lines; if it grows larger, extract the table rows as a subcomponent.
5. Add `backups` (from `useBackups`) to `use-project-detail.ts`.
6. Find the component that consumes `backupStatus` from `useProjectDetail` (grep for it). Mount `<BackupPanel project={project} backups={backups} />` below the health card area, guarded by `project?.config.postgres?.backupBucket`.
7. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add BackupObject type + four API functions
- new file: `apps/dashboard/src/lib/use-backups.ts` — backup list/trigger/delete hook
- new file: `apps/dashboard/src/components/detail/backup-panel.tsx` — panel component
- `apps/dashboard/src/lib/use-project-detail.ts` — add backups from useBackups
- one existing page/shell component — mount BackupPanel (identify via grep)

## Acceptance criteria

- [x] `BackupObject` type and `listBackups`, `deleteBackup`, `triggerBackup`, `getBackupDownloadUrl` exported from `api.ts`
- [x] `use-backups.ts` exists and manages list, delete, trigger, and download actions
- [x] `backup-panel.tsx` renders the table with size and age formatting
- [x] Delete requires two clicks (arm → confirm); second click calls `deleteBackup`
- [x] "Back up now" button is disabled and shows loading state while trigger is in flight
- [x] Panel is only rendered when `postgres.backupBucket` is set in project config
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added the full backup management panel to the project detail page. `api.ts` already had the four client functions from context (they were in the existing file). Created `use-backups.ts` with optimistic delete, trigger-with-loading, and presigned-URL download. The `BackupPanel` component renders a card matching the existing health-card layout: header row with icon + label + "Back up now" button, then a list of dump files with formatted size/age, download button, and two-click delete with `onBlur` cancel. Added missing `download` and `hash` icon paths to `icon.tsx` (both were missing; `hash` was already used in health-card). Mounted the panel in the project detail page guarded by `project.config.postgres?.backupBucket`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — `BackupObject` interface + four API client functions (already present from session context)
- (new) `apps/dashboard/src/lib/use-backups.ts` — backup list/delete/trigger/download hook
- (new) `apps/dashboard/src/components/detail/backup-panel.tsx` — panel component with table, age/size formatting, two-click delete, trigger button
- `apps/dashboard/src/lib/use-project-detail.ts` — added `useBackups` import and `backups` in return value
- `apps/dashboard/app/projects/[name]/page.tsx` — imported `BackupPanel`, destructured `backups`, mounted panel guarded by `backupBucket`
- `apps/dashboard/src/components/icon.tsx` — added `download` and `hash` icon paths

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `hash` icon was already used in health-card.tsx but was missing from icon.tsx — has been fixed here as a side effect
- `[defer]` BackupPanel has no per-row error feedback (delete failure silently re-fetches); could add inline error state later

## Out of scope

- Backup size trend sparkline (sprint 127)
- Retention control UI (sprint 128)
- Toasts / success notifications (can be added later)
