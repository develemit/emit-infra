# Sprint 134 — Cron job monitor panel

**Difficulty:** 2

## Goal

Add a dashboard panel on the project detail page that displays all active cron jobs (schedule, command, source), sourced from the API route built in sprint 133.

## Reason

Sprint 133 exposes the cron data; this sprint makes it visible in the dashboard. Cron jobs can accumulate over time — old backup scripts, migration runners, stale maintenance tasks. Seeing them at a glance surfaces surprises before they become incidents.

## Context

- Builds on sprint 133: `GET /projects/:name/cron-jobs` returns `{ jobs: [{ schedule, command, user?, source }] }`.
- Add `getCronJobs(name)` to `apps/dashboard/src/lib/api.ts`. Follow the exact fetch pattern of other functions there.
- Component: `apps/dashboard/src/components/detail/cron-panel.tsx`. Use local `useState` + `useEffect` — on-demand with a Refresh button.
- Layout: card with title "Cron Jobs" and `clock` icon. Rows show:
  - `schedule` in mono (bold)
  - `command` in mono (truncated, `max-w-[320px]`)
  - `source` path in a subtle smaller font below the command
  - If `user` is set, show it as a dim badge next to the schedule.
- If `jobs.length === 0`: show "No cron jobs found" in subtle mono text.
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` after `DockerUsage` and before the `DeployTimeline` block. Always rendered when status is available (cron jobs exist on any project).
- Guard: only render when `status !== null && !status?.error`.

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 20 lines) to confirm fetch pattern.
2. Add `export interface CronJob { schedule: string; command: string; user?: string; source: string }` and `getCronJobs(name: string): Promise<CronJob[]>` to `apps/dashboard/src/lib/api.ts`.
3. Create `apps/dashboard/src/components/detail/cron-panel.tsx`.
4. Mount `<CronPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` guarded by `status !== null && !status?.error`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `CronJob` interface and `getCronJobs`
- new file: `apps/dashboard/src/components/detail/cron-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel renders one row per cron job with schedule, command (truncated), and source
- [x] `user` field shows as dim badge when present (`/etc/cron.d/` entries)
- [x] Shows "No cron jobs found" when list is empty
- [x] Refresh button re-fetches on click with loading state
- [x] Panel only renders when status is available and not errored
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `CronJob` interface and `getCronJobs()` to `api.ts`. Created `CronPanel` component with per-row schedule (bold mono), command (truncated), source (dim subtitle), and optional user badge. Empty state "No cron jobs found", Refresh button with loading state. Mounted in page.tsx after DockerUsage, guarded by `status !== null && !status?.error`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `CronJob` interface and `getCronJobs`
- (new) `apps/dashboard/src/components/detail/cron-panel.tsx` — cron jobs panel
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `CronPanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Last-run timestamp display
- Enable/disable toggles
- Cron expression human-readable translation (e.g. "every day at 2am")
