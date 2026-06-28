# Sprint 106 — Fleet/CI status filter + clickable deploy markers

**Difficulty:** 3

## Goal

Add a status filter to the fleet health page and CI page so users can narrow to failing/warning projects, and make deploy markers on the resource chart clickable — linking to the deploy log for that SHA.

## Reason

With more than a handful of projects, the fleet health and CI pages require scanning the entire list to find problems. A filter button row ("All / Warning / Failing") lets operators surface only what needs attention. Separately, deploy markers on resource charts are currently decorative circles — you can see that a deploy happened during a CPU spike but can't click through to see what changed, which is the natural next step during incident triage.

## Context

### Fleet/CI filter
- `apps/dashboard/app/health/page.tsx` — renders a table of all projects. Read the file to understand the `FleetRow` data shape. Add filter state (`'all' | 'warn' | 'fail'`) and a button group above the table. The filter applies to the in-memory `rows` array — no new API calls needed. A "failing" row is one where HTTP status is non-2xx, disk/mem > 90%, CI pass rate < 70%, or backup age > 48h. "Warning" is the yellow threshold level. The health thresholds are already defined as helper functions in this file — reuse them.
- `apps/dashboard/app/ci/page.tsx` — same filter pattern. Read the file. A CI row "fails" when pass rate < 70%; "warns" when < 90%.

### Clickable deploy markers
- `apps/dashboard/src/components/detail/resource-chart.tsx` — deploy markers are rendered as SVG circles (or similar). Read the file to locate where they're drawn. Each marker should have an `onClick` that navigates to `/projects/[name]/deploy-log/[sha]` — the deploy log page. The `name` is available from the chart's props, the `sha` comes from the deploy marker data. Use Next.js `useRouter().push(...)` or an `<a>` tag.
- Check `apps/dashboard/app/projects/[name]/deploy-log/[sha]/page.tsx` to confirm the route exists and understand the URL shape.

## Tasks

1. Read `apps/dashboard/app/health/page.tsx` fully. Add a filter state and button group (`All | Warning | Failing`). Apply filter to the rows array before rendering the table and mobile cards.
2. Read `apps/dashboard/app/ci/page.tsx` fully. Add the same filter pattern.
3. Read `apps/dashboard/src/components/detail/resource-chart.tsx` fully. Locate deploy marker rendering. Add `onClick` → navigate to deploy log. Add `cursor-pointer` styling and a tooltip/title attribute with the SHA.
4. Confirm the deploy-log route path by checking `apps/dashboard/app/projects/[name]/deploy-log/[sha]/page.tsx`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`.

## Files involved

- `apps/dashboard/app/health/page.tsx` — add filter state + button group + filtered row list
- `apps/dashboard/app/ci/page.tsx` — add filter state + button group + filtered row list
- `apps/dashboard/src/components/detail/resource-chart.tsx` — add onClick + cursor-pointer to deploy markers

## Acceptance criteria

- [x] Fleet health page has "All / Warning / Failing" filter buttons; clicking filters the visible rows
- [x] CI page has the same filter
- [x] "All" is the default; filter persists while the page auto-refreshes (stored in state, not URL)
- [x] Deploy markers on resource chart are clickable and navigate to the correct deploy-log page
- [x] Deploy markers have a visible cursor-pointer style and a title/tooltip showing the SHA
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Added a `rowLevel()` helper to `health/page.tsx` that classifies each fleet row as `'fail' | 'warn' | 'ok'` using the existing threshold logic (disk/mem >90% = fail, >75% = warn; HTTP non-2xx = fail; CI pass rate <70% = fail, <90% = warn; backup age >49h = fail, >25h = warn; SSL <30d = warn). A `filter` state and 3-button group (`All | Warning | Failing`) appear above both desktop and mobile layouts; the rows are filtered inline before `.map()`. Same pattern applied to `ci/page.tsx` with a simpler `statsLevel()` based only on pass rate. In `resource-chart.tsx`, added `useRouter` from `next/navigation`; each deploy marker `<g>` now has an `onClick` navigating to `/projects/[name]/deploy-log/[sha]` when `sha` is present, `cursor-pointer` style, and a `<title>` SVG element showing the short SHA.

### Files changed
- `apps/dashboard/app/health/page.tsx` — added `rowLevel()`, `filter` state, filter button group, filtered rows in desktop table and mobile cards
- `apps/dashboard/app/ci/page.tsx` — added `statsLevel()`, `filter` state, filter button group, filtered stats in desktop and mobile
- `apps/dashboard/src/components/detail/resource-chart.tsx` — added `useRouter`, clickable deploy markers with `cursor-pointer` + SVG `<title>`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` Filter button counts (e.g. "Failing (2)") would help operators see how many projects are in each state without clicking — easy to add later

## Out of scope

- URL-persisted filter state (query params)
- Sorting the table by column
- Filtering by project name / search
- Pagination (that's a backlog item for much larger fleets)
