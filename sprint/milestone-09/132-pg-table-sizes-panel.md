# Sprint 132 — PostgreSQL table sizes panel

**Difficulty:** 2

## Goal

Add a dashboard panel on the project detail page that displays the top-10 Postgres tables by size, showing table name, row estimate, and total size formatted as human-readable bytes.

## Reason

The API route from sprint 131 returns the data; this sprint makes it visible. Without a UI surface, the data is only accessible via curl. The panel gives developers an at-a-glance view of which tables are consuming the most space — essential context for diagnosing disk growth.

## Context

- Builds on sprint 131: `GET /projects/:name/pg-table-sizes` is already implemented and returns `{ tables: [{ name, totalBytes, rowEstimate }] }`.
- Add `getPgTableSizes(name)` to `apps/dashboard/src/lib/api.ts`. Follow the exact pattern of other fetch functions there (uses `API_BASE`, `authHeaders()`, `cache: 'no-store'`).
- Component pattern: `apps/dashboard/src/components/detail/pg-table-sizes-panel.tsx`. Use local `useState` + `useEffect` — no custom hook needed for on-demand display. Include a "Refresh" button.
- `formatBytes` helper: same formula used in `apps/dashboard/src/components/detail/backup-panel.tsx` — copy it locally.
- Format `rowEstimate`: if ≥ 1000, use `${(n/1000).toFixed(0)}k`. If ≥ 1_000_000, use `${(n/1_000_000).toFixed(1)}M`.
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` after `BackupPanel`, guarded by `project?.config.postgres != null`. Place it after the BackupPanel block (search for `{project?.config.postgres?.backupBucket && (<BackupPanel`).
- Icon to use: `database` (already in `icon.tsx`).

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 30 lines) to see the exact `authHeaders` / fetch pattern to match.
2. Add `export interface PgTable { name: string; totalBytes: number; rowEstimate: number }` and `getPgTableSizes(name: string): Promise<PgTable[]>` to `apps/dashboard/src/lib/api.ts`.
3. Create `apps/dashboard/src/components/detail/pg-table-sizes-panel.tsx` — card with title "Table Sizes", table rows: name (mono), row count estimate, total size formatted. Refresh button. Loading/error states.
4. Import and mount `<PgTableSizesPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx`, guarded by `project?.config.postgres != null`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `PgTable` interface and `getPgTableSizes`
- new file: `apps/dashboard/src/components/detail/pg-table-sizes-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel renders top-10 tables with name, row estimate, and formatted total size
- [x] Refresh button re-fetches and shows loading state
- [x] Panel only rendered when `project.config.postgres` is set
- [x] Empty/error state handled gracefully (shows message, not a crash)
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `PgTable` interface and `getPgTableSizes()` to `api.ts`. Created `PgTableSizesPanel` with a 3-column table (Name, Rows, Size), local formatBytes/formatRowEstimate helpers, loading/error/empty states, and a Refresh button. Mounted in page.tsx after BackupPanel guarded by `project?.config.postgres != null`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `PgTable` interface and `getPgTableSizes`
- (new) `apps/dashboard/src/components/detail/pg-table-sizes-panel.tsx` — table sizes panel
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `PgTableSizesPanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Per-index drill-down
- Table growth trend over time
- Sorting / filtering in the panel
