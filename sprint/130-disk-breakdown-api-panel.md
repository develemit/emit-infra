# Sprint 130 — Directory disk breakdown

**Difficulty:** 2

## Goal

Add a `GET /projects/:name/disk-dirs` API route and a compact panel on the project detail page showing per-directory disk usage for the major server directories, with a refresh-on-demand button.

## Reason

The HealthCard shows overall disk % but not *which* directory is consuming space. When a disk alert fires, operators need to know immediately whether it's logs, app data, Postgres, or Docker images filling up — without SSHing in manually. This is pure SSH + display with no historical data needed.

## Context

- Create `apps/api/src/routes/disk.ts` — new route file. Register it in `apps/api/src/index.ts` alongside the existing registrations (pattern: `await app.register(diskRoutes)`).
- SSH pattern from `apps/api/src/routes/projects.ts`: import `sshExec` from `@emit-infra/core`, `findProject` and `sshKeyPath` from `../lib/project-helpers.js`. Resolve host/key as: `const key = sshKeyPath(project.config.sshKeyName)` and `const host = project.config.serverIp ?? project.config.domain`.
- TTL cache: `createTtlCache<T>(ms)` from `../lib/ttl-cache.js`. Use 60_000ms (data doesn't change fast).
- Zod param guard: `z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })`.
- SSH command: `sudo du -sb /app /var/log /var/lib/postgresql /var/lib/docker /home /tmp 2>/dev/null | sort -rn` — returns `<bytes>\t<path>` per line, sorted descending. `2>/dev/null` silences missing dirs.
- Dashboard fetch: add `getDiskDirs(name)` to `apps/dashboard/src/lib/api.ts` (follow pattern of other fetch functions there).
- Component pattern: simple `useState` + `useEffect` inside the component is fine (no polling, on-demand only). No separate hook file needed.
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` after the disk trend warning chip, guarded by `status !== null && !status?.error`.
- `formatBytes` helper: already implemented in `apps/dashboard/src/components/detail/backup-panel.tsx` — copy the same formula.

## Tasks

1. Read `apps/api/src/index.ts` to confirm the route registration pattern.
2. Create `apps/api/src/routes/disk.ts` with `GET /projects/:name/disk-dirs`. Parse `<bytes>\t<path>` output, return `{ dirs: { path: string; bytes: number }[] }`.
3. Register `diskRoutes` in `apps/api/src/index.ts`.
4. Add `export interface DiskDir { path: string; bytes: number }` and `getDiskDirs(name: string): Promise<DiskDir[]>` to `apps/dashboard/src/lib/api.ts`.
5. Create `apps/dashboard/src/components/detail/disk-dirs-panel.tsx`. Card layout with: title "Disk Usage by Directory", table rows (path, formatted size, relative bar), and a "Refresh" button that re-fetches on click.
6. Mount `<DiskDirsPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` after the disk trend chip block, guarded by `status !== null && !status?.error`.
7. Run `pnpm nx typecheck api --skip-nx-cache` and `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/disk.ts` — disk-dirs route
- `apps/api/src/index.ts` — register disk routes
- `apps/dashboard/src/lib/api.ts` — add `DiskDir` interface and `getDiskDirs`
- new file: `apps/dashboard/src/components/detail/disk-dirs-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] `GET /projects/:name/disk-dirs` returns `{ dirs: { path, bytes }[] }` sorted descending by bytes
- [x] Missing directories (silenced by `2>/dev/null`) produce no errors — they simply don't appear in the list
- [x] Panel renders a row per directory with human-readable size and a proportional bar
- [x] Refresh button re-fetches on click and shows a loading state while fetching
- [x] Panel only renders when `status !== null && !status?.error`
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/disk.ts` with `GET /projects/:name/disk-dirs` — SSHes into the server, runs `sudo du -sb` across 6 major directories, parses `<bytes>\t<path>` output, and returns sorted descending with a 60s TTL cache. Registered in `index.ts`. Added `DiskDir` interface and `getDiskDirs()` fetch function to `api.ts`. Created `DiskDirsPanel` component with per-row size formatting, proportional bars, and a Refresh button. Mounted in page.tsx after the disk trend chip, guarded by `status !== null && !status?.error`.

### Files changed
- (new) `apps/api/src/routes/disk.ts` — disk-dirs route with TTL cache
- `apps/api/src/index.ts` — registered `diskRoutes`
- `apps/dashboard/src/lib/api.ts` — added `DiskDir` interface and `getDiskDirs`
- (new) `apps/dashboard/src/components/detail/disk-dirs-panel.tsx` — panel with bars + refresh
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `DiskDirsPanel`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `/var/lib/docker` requires sudo — on some servers this may be denied; a graceful fallback (skip row) is already handled by `2>/dev/null`

## Out of scope

- Historical disk-per-directory trending
- Interactive drill-down into subdirectories
- Configurable directory list (the hardcoded set is sufficient)
