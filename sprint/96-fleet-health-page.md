# Sprint 96 — Fleet health page (`/health`)

**Difficulty:** 3

## Goal

Add a `/health` page to the dashboard that shows every project's health in a compact, scannable grid — HTTP status, disk%, memory%, last deploy age, CI pass rate, and backup age — so the full fleet state is visible at a glance without clicking into each project card.

## Reason

The home page (`/`) shows project cards but requires scrolling and clicking to assess fleet health. During an incident or morning check-in, you want to scan all projects in one view and immediately see which one needs attention. This page is also the ideal target for the `emit-infra triage` CLI to link to.

## Context

- Home page is `apps/dashboard/app/page.tsx` — look at how it fetches projects and status in parallel to understand the data-loading pattern. The fleet health page follows the same pattern but renders a dense table instead of cards.
- Data sources (all existing endpoints):
  - `GET /projects` — list of projects with config
  - `GET /projects/:name/status` — HTTP status, disk%, memory%, SSL expiry, nginx, redis, deployed timestamp
  - `GET /projects/:name/ci-history?limit=20` — for pass rate
  - `GET /projects/:name/backup-status` — lastRun + status
- The page should fetch all project statuses in parallel (`Promise.all`) after getting the project list. Show a skeleton state while loading.
- Sidebar nav: `apps/dashboard/src/components/shell/sidebar.tsx` — add a "Fleet" nav item with a suitable icon (e.g. `"grid"` or `"layers"`). Check existing nav items for the pattern.
- Tab bar (mobile): `apps/dashboard/src/components/shell/tab-bar.tsx` — add Fleet here too.
- Column layout for the table: Project | HTTP | Disk | Memory | SSL | Last Deploy | CI Pass | Backup
- Color coding: reuse the same threshold logic as existing components — disk/mem >90% → red, >75% → yellow; CI pass rate <70% → red, <90% → yellow; backup age >25h → yellow, >49h → red; SSL <7d → red, <30d → yellow.
- This page is read-only — no actions, just status.

## Tasks

1. Read `apps/dashboard/app/page.tsx`, `sidebar.tsx`, and `tab-bar.tsx` to understand nav and data-load patterns.
2. Create `apps/dashboard/app/health/page.tsx` as a `'use client'` component. Fetch all projects, then fan out to status + CI history + backup status in parallel per project.
3. Render a desktop table (hidden on mobile) with all 8 columns. Use color-coded text/badges matching the thresholds above.
4. Render mobile cards (md:hidden) — one card per project showing the same data vertically.
5. Add a "Fleet" nav item to `sidebar.tsx` and `tab-bar.tsx`.
6. Run `pnpm nx typecheck dashboard`.

## Files involved

- (new) `apps/dashboard/app/health/page.tsx` — the fleet health page
- `apps/dashboard/src/components/shell/sidebar.tsx` — add Fleet nav link
- `apps/dashboard/src/components/shell/tab-bar.tsx` — add Fleet tab

## Acceptance criteria

- [x] `/health` page loads and shows a row per project
- [x] Each row shows: HTTP status, disk%, memory%, SSL expiry, last deploy age, CI pass rate (last 20 runs), backup status
- [x] Color thresholds applied: disk/mem, CI rate, backup age, SSL expiry
- [x] "Fleet" nav item appears in sidebar and mobile tab bar, links to `/health`
- [x] Page auto-refreshes every 60 seconds (same pattern as `/ci` page from sprint 92)
- [x] `pnpm nx typecheck dashboard` clean

## Completed

**Date:** 2026-06-28

### Summary
Added `/health` fleet health page as a `'use client'` component that fetches all projects then fans out in parallel to `getStatus`, `getCiHistory` (last 20 runs), and `getBackupStatus` per project. Renders a desktop table with 8 columns (Project, HTTP, Disk, Memory, SSL, Last Deploy, CI Pass, Backup) and mobile cards with the same data in a grid layout. Color thresholds applied: disk/memory >90% red / >75% yellow; CI pass rate <70% red / <90% yellow; backup age >49h red / >25h yellow; SSL <7d red / <30d yellow. Added `layers` icon to `icon.tsx`, Fleet nav item to sidebar and tab bar, and `/health` path to `pathToActive` in `shell.tsx`. Auto-refreshes every 60s, cancels on unmount.

### Files changed
- (new) `apps/dashboard/app/health/page.tsx` — fleet health page with table + mobile cards
- `apps/dashboard/src/components/icon.tsx` — added `layers` icon path
- `apps/dashboard/src/components/shell/sidebar.tsx` — added Fleet nav item
- `apps/dashboard/src/components/shell/tab-bar.tsx` — added Fleet tab
- `apps/dashboard/src/components/shell/shell.tsx` — added `/health` → `'health'` to `pathToActive`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Sorting / filtering the fleet table
- Project actions from this page (deploy, rollback, etc.)
- Historical fleet health trends
