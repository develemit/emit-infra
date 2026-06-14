# Sprint 50 — Container Restart Button in ContainerTable
**Difficulty:** 3

## Goal
Add a per-container restart button to the ContainerTable so operators can restart a stopped or crashing container without leaving the dashboard.

## Reason
The ContainerTable shows state (running / exited / restarting) and a logs link — but offers no way to act. Restarting a container currently requires SSH or CLI. Since the API already pattern-matches SSH exec calls (see `docker-prune` in `projects.ts`), adding a restart endpoint is low-risk and follows the existing pattern exactly.

## Context
**API pattern:** `POST /projects/:name/containers/:container/restart` should SSH in, run `docker restart <container>`, and return `{ ok: boolean; output: string }`. Look at the existing `app.post('/projects/:name/prune', ...)` handler in `apps/api/src/routes/projects.ts` for the exact pattern — it's a non-SSE SSH exec with JSON response.

**ContainerTable** (`apps/dashboard/src/components/detail/container-table.tsx`) renders:
- Desktop: a `<table>` with a final `<td>` column that currently only has a logs link icon
- Mobile: `<MContainer>` card with the same logs link

The restart button should live in that last column/slot. It should:
1. Show a rotate/restart icon (check what icon names are available in `apps/dashboard/src/components/icon.tsx` or the icon map)
2. Call `restartContainer(projectName, containerName)` on click
3. Show a brief loading state (disable the button while in-flight)
4. On success: call `onRefetch()` so the table refreshes

**API lib:** add `restartContainer(name: string, container: string): Promise<{ ok: boolean; output: string }>` to `apps/dashboard/src/lib/api.ts` following the same pattern as `pruneDocker`.

**Detail page:** `apps/dashboard/app/projects/[name]/page.tsx` passes `fetchData` to DockerUsage for its onPrune callback — do the same for ContainerTable's new `onRefetch` prop.

## Tasks
1. Read `apps/api/src/routes/projects.ts` — find the prune endpoint to understand the pattern.
2. Add `POST /projects/:name/containers/:container/restart` to `projects.ts`:
   ```ts
   app.post<{ Params: { name: string; container: string } }>(
     '/projects/:name/containers/:container/restart',
     async (req, reply) => { ... }
   )
   ```
   SSH exec: `docker restart ${req.params.container}`
   Return `{ ok: true, output }` on success, `{ ok: false, output }` on SSH error (non-fatal — don't 500).
3. Add `restartContainer(projectName, containerName)` to `apps/dashboard/src/lib/api.ts`.
4. Read `apps/dashboard/src/components/detail/container-table.tsx` in full.
5. Add `onRefetch?: () => void` prop to `ContainerTableProps` and `MContainer`.
6. Add a restart button in the last column of the desktop table row and in `MContainer`. Use a small icon button (look up "refresh" or "restart" in the icon set). Disable while in-flight; call `onRefetch?.()` on success.
7. Read `apps/dashboard/app/projects/[name]/page.tsx` — pass `onRefetch={fetchData}` to `ContainerTable`.
8. Run typecheck.

## Files involved
- `apps/api/src/routes/projects.ts` — new `POST /projects/:name/containers/:container/restart` endpoint
- `apps/dashboard/src/lib/api.ts` — add `restartContainer()`
- `apps/dashboard/src/components/detail/container-table.tsx` — add `onRefetch` prop + restart button
- `apps/dashboard/app/projects/[name]/page.tsx` — wire `onRefetch={fetchData}` into ContainerTable

## Acceptance criteria
- [x] `POST /projects/:name/containers/:container/restart` endpoint exists and returns `{ ok, output }`
- [x] Restart button appears per-row on desktop table and per-card on mobile
- [x] Button is disabled (not clickable) while the restart call is in-flight
- [x] On success the container list refreshes (table re-renders with updated state)
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
Added `POST /projects/:name/containers/:container/restart` to the API (SSH exec `docker restart <container>`, returns `{ ok, output }`, invalidates containers cache). Added `restartContainer()` to the dashboard API lib. Converted ContainerTable to a `'use client'` component with per-row restart state tracked via a `Set`. Restart button (refresh icon) appears in desktop table's last column and in each mobile card; button is disabled during in-flight call and calls `onRefetch?.()` on success. Wired `onRefetch={fetchData}` in the project detail page.

### Files changed
- `apps/api/src/routes/projects.ts` — new `POST /projects/:name/containers/:container/restart` endpoint
- `apps/dashboard/src/lib/api.ts` — added `restartContainer()`
- `apps/dashboard/src/components/detail/container-table.tsx` — added `'use client'`, `onRefetch` prop, restart button per row/card
- `apps/dashboard/app/projects/[name]/page.tsx` — passed `onRefetch={fetchData}` to ContainerTable

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- Restarting all containers at once (add later if needed)
- SSE streaming for restart output (fire-and-forget JSON is sufficient)
- Auth/confirmation modal before restarting (single click is fine for now)
