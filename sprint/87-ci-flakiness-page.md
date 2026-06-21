# Cross-project CI flakiness table
**Difficulty:** 3

## Goal
Add a `/ci` dashboard page with a table showing all projects side by side: pass rate (last 30 runs), average duration, last run status, and last run time. Makes it easy to spot a degrading test suite across all projects without clicking into each one individually.

## Reason
Individual project CI stats are visible on the detail page, but there's no cross-project view. When CI starts getting flaky on one project, it's easy to miss while you're focused elsewhere. A single page that shows all projects' CI health side by side turns reactive debugging into proactive monitoring.

## Context

### Data available
- API route `GET /projects/:name/ci-history?limit=30` already exists (`apps/api/src/routes/history.ts`). Returns an array of `CiHistoryEntry { status, sha, branch, startedAt, completedAt, durationSec }`.
- `getCiHistory(name)` already exists in `apps/dashboard/src/lib/api.ts` (added in sprint 73).
- `getProjects()` returns all `ProjectSummary[]`.

### Page structure
- New file: `apps/dashboard/app/ci/page.tsx` — client component.
- On mount, call `getProjects()` then `getCiHistory(name, 30)` for each project in parallel.
- Derive per-project stats:
  - `passRate`: `successes / total` (where success = status !== 'failure')
  - `avgDuration`: mean of `durationSec`
  - `lastStatus`: `runs[0]?.status`
  - `lastRun`: `runs[0]?.completedAt`
- Render a table (or card-based list on mobile) with columns: **Project**, **Pass rate**, **Avg duration**, **Last run**, **Last status**.
- Sort by pass rate ascending (worst first) so degrading projects float to the top.
- Pass rate color: green ≥90%, amber 70–89%, red <70%.
- While loading, show skeleton rows.

### Navigation
- Add a "CI" nav item to the sidebar/nav. Look at `apps/dashboard/src/components/nav.tsx` (or equivalent layout file) to understand how nav items are structured. Add a "CI" link with an appropriate icon (e.g. `zap`).

### formatDuration helper
`ci-timeline.tsx` already has a `formatDuration(sec)` function. Extract it to `apps/dashboard/src/lib/format-duration.ts` and import from both `ci-timeline.tsx` and the new page. (If extracting is out of scope, just duplicate the 5-line function for now and note it in a comment.)

## Tasks
1. Read the nav/layout component to understand how to add a new nav item.
2. Create `apps/dashboard/app/ci/page.tsx` — fetches all projects, then CI history for each in parallel, derives stats, renders table.
3. Add "CI" nav item to the nav component linking to `/ci`.
4. Optionally extract `formatDuration` to a shared util (preferred but not blocking).

## Files involved
- `apps/dashboard/app/ci/page.tsx` — new page
- `apps/dashboard/src/components/nav.tsx` (or layout equivalent) — add CI nav link
- `apps/dashboard/src/lib/format-duration.ts` — optional extraction of shared helper

## Acceptance criteria
- [x] `/ci` page loads and shows one row per project
- [x] Pass rate, avg duration, last run timestamp, and last status are correct for each project
- [x] Projects are sorted worst pass rate first
- [x] Pass rate is color-coded green/amber/red
- [x] Loading state shows skeletons
- [x] Projects with no CI history show "no runs" row (not an error)
- [x] CI nav item appears in sidebar and is active when on `/ci`
- [x] `pnpm typecheck` passes

## Completed

**Date:** 2026-06-21

### Summary
Added a `/ci` dashboard page showing cross-project CI health in a table. Fetches last 30 CI runs for each project in parallel via `getCiHistory`, derives pass rate, average duration, last run time, and last status. Projects are sorted worst pass rate first so degrading suites float to the top. Pass rate is color-coded green (>=90%), amber (70-89%), red (<70%). Projects with no CI runs show a "no runs" row instead of an error.

Extracted `formatDuration` from `ci-timeline.tsx` into a shared `format-duration.ts` utility and updated the import in `ci-timeline.tsx`. Added "CI" nav item (with `zap` icon) to the sidebar, mobile tab bar, and shell's `pathToActive` routing.

The page uses a table layout on desktop and card-based layout on mobile, with skeleton loading states for both.

### Files changed
- (new) `apps/dashboard/app/ci/page.tsx` — CI overview page, 208 lines
- (new) `apps/dashboard/src/lib/format-duration.ts` — shared `formatDuration` helper
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — imports `formatDuration` from shared util instead of local definition
- `apps/dashboard/src/components/shell/sidebar.tsx` — added CI nav item
- `apps/dashboard/src/components/shell/tab-bar.tsx` — added CI nav item
- `apps/dashboard/src/components/shell/shell.tsx` — added `/ci` to `pathToActive`
- `sprint/87-ci-flakiness-page.md` — marked complete

### Verification
- `pnpm nx typecheck dashboard`: clean

### Follow-ups
- `[defer]` The CI page fetches all project histories on mount but doesn't poll for updates. Could add a 60s interval refresh for live dashboarding.
- `[defer]` Could link each project row to the project detail page's CI timeline for drill-down.

## Out of scope
- Per-branch breakdown
- CI duration trend chart
- Filtering by date range or branch
- Linking CI rows to the log viewer (use the existing detail page for that)
