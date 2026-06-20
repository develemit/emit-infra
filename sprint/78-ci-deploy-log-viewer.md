# Dashboard log viewer for CI and deploy runs
**Difficulty:** 3

## Goal
Each row in the CI History and Deploy History timelines becomes a clickable link that navigates to a dedicated log viewer page showing the full terminal output for that run. Rows for runs that predate log capture show a graceful "no log available" state instead of an error.

## Reason
The history timelines show what happened (status, duration, SHA) but not why. A failed CI run currently requires SSHing into the machine or checking a local terminal. With log capture now in place (sprint 76) and the API route to serve it (sprint 77), this sprint closes the loop by making failures directly inspectable from the dashboard.

## Context
- `apps/dashboard/src/components/detail/ci-timeline.tsx` and `deploy-timeline.tsx` render the history lists. Each entry has `sha`, `branch`, `status`, `completedAt`, `durationSec`. The SHA is the full 40-char hash from `.ci-history.jsonl` / `.deploy-history.jsonl`. Currently rows are plain `<div>` elements.
- The existing log viewer at `apps/dashboard/app/projects/[name]/logs/page.tsx` uses the `Terminal` component from `@/components/ui/terminal` to display lines. That same component should be used here for visual consistency.
- The existing logs page streams live Docker output via SSE (`openSseStream`). The new log pages fetch a completed static file — no streaming needed. Fetch once on mount, split by newline, render.
- `getCiLog(name, sha)` and `getDeployLog(name, sha)` are added by sprint 77 in `apps/dashboard/src/lib/api.ts`. They return empty string on 404.
- New pages live at:
  - `apps/dashboard/app/projects/[name]/ci-log/[sha]/page.tsx`
  - `apps/dashboard/app/projects/[name]/deploy-log/[sha]/page.tsx`
- The `[name]` segment is already used by the project detail page — this just adds a sibling route.
- Both log pages are nearly identical. Extract shared logic into a single `RunLogPage` component in `apps/dashboard/src/components/detail/run-log-page.tsx` that accepts `type: 'ci' | 'deploy'`, `name`, `sha` as props. Both page files are thin wrappers.
- `RunLogPage` should be under 150 lines. If it grows, split the loading/empty states into sub-components.

## Tasks
1. In `apps/dashboard/src/components/detail/ci-timeline.tsx`: wrap each row's outer `<div>` in a `<Link href={/projects/${encodeURIComponent(name)}/ci-log/${r.sha}>`. The component needs a `name` prop added to its `Props` interface and passed down from the page. Add `import Link from 'next/link'`.

2. In `apps/dashboard/src/components/detail/deploy-timeline.tsx`: same — add `name` prop, wrap rows in `<Link href={/projects/${encodeURIComponent(name)}/deploy-log/${d.sha}>`.

3. Update `apps/dashboard/app/projects/[name]/page.tsx` to pass `name` to both `<DeployTimeline>` and `<CiTimeline>`.

4. Create `apps/dashboard/src/components/detail/run-log-page.tsx`:
   - Props: `{ type: 'ci' | 'deploy'; name: string; sha: string }`
   - On mount: fetch log via `getCiLog` or `getDeployLog` depending on `type`
   - States: loading spinner, "no log available" (empty string returned), log lines rendered
   - Render log lines inside `<Terminal>` — split content by `\n`, map each to a `<div className="ec-ln">` with a `<span>` for the text (same pattern as `logs/page.tsx` lines 131–141)
   - Header: back link to `/projects/[name]`, title "CI Log" or "Deploy Log", SHA (first 7 chars), status badge if derivable
   - Desktop topbar + mobile header same layout pattern as `logs/page.tsx`
   - Show "Log not available — this run predates log capture" when content is empty string

5. Create `apps/dashboard/app/projects/[name]/ci-log/[sha]/page.tsx`:
   ```tsx
   'use client'
   import { useParams } from 'next/navigation'
   import { RunLogPage } from '@/components/detail/run-log-page'
   export default function CiLogPage() {
     const params = useParams()
     const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''
     const sha = typeof params['sha'] === 'string' ? params['sha'] : ''
     return <RunLogPage type="ci" name={name} sha={sha} />
   }
   ```

6. Create `apps/dashboard/app/projects/[name]/deploy-log/[sha]/page.tsx` — identical but `type="deploy"`.

7. Run `pnpm nx typecheck dashboard` — must be clean.

## Files involved
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — add `name` prop, wrap rows in `<Link>`
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — add `name` prop, wrap rows in `<Link>`
- `apps/dashboard/app/projects/[name]/page.tsx` — pass `name` prop to both timelines
- new file: `apps/dashboard/src/components/detail/run-log-page.tsx` — shared log viewer component
- new file: `apps/dashboard/app/projects/[name]/ci-log/[sha]/page.tsx` — thin wrapper page
- new file: `apps/dashboard/app/projects/[name]/deploy-log/[sha]/page.tsx` — thin wrapper page

## Acceptance criteria
- [x] Clicking a CI history row navigates to `/projects/[name]/ci-log/[sha]`
- [x] Clicking a deploy history row navigates to `/projects/[name]/deploy-log/[sha]`
- [x] Log viewer shows full terminal output for runs after sprint 76 was deployed
- [x] Log viewer shows "Log not available — this run predates log capture" for older runs (empty log)
- [x] Back link returns to the project detail page
- [x] `pnpm nx typecheck dashboard` passes clean
- [x] `run-log-page.tsx` is under 150 lines (84 lines)
- [x] Mobile layout works (same header pattern as existing logs page)

## Completed

**Date:** 2026-06-20

### Summary
Added `name` prop to both `CiTimeline` and `DeployTimeline`, and wrapped each history row in a `<Link>` navigating to the new log pages. The SHA clipboard-copy `onClick` in `deploy-timeline.tsx` was removed since the row is now a navigation link; the SHA is visible in the URL and on the log page itself.

`RunLogPage` is a single shared component (84 lines) used by both new page routes. It fetches the log on mount via `getCiLog`/`getDeployLog`, shows a "loading…" state, then renders lines in the `Terminal` component matching the existing logs page pattern. An empty string response (404 from API) renders the "predates log capture" message. Desktop topbar and mobile header follow the exact same layout as `logs/page.tsx`.

### Files changed
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — added `name` prop and `Link` import; rows wrapped in `<Link>` to `/ci-log/:sha`
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — same; removed SHA clipboard onClick (replaced by link navigation)
- `apps/dashboard/app/projects/[name]/page.tsx` — passes `name` prop to `<DeployTimeline>` and `<CiTimeline>`
- (new) `apps/dashboard/src/components/detail/run-log-page.tsx` — shared log viewer component, 84 lines
- (new) `apps/dashboard/app/projects/[name]/ci-log/[sha]/page.tsx` — thin wrapper, type="ci"
- (new) `apps/dashboard/app/projects/[name]/deploy-log/[sha]/page.tsx` — thin wrapper, type="deploy"

### Verification
- `pnpm nx typecheck dashboard`: clean
- `run-log-page.tsx`: 84 lines (limit 150)

### Follow-ups
- `[defer]` The SHA clipboard-copy feature on deploy rows was removed when the row became a link. Could restore it as a small copy button (icon only) next to the SHA with `e.preventDefault()` to avoid navigation on click.
- `[defer]` Log viewer starts at the top of the file. For CI/deploy logs, the tail (final result) is usually most relevant. Could auto-scroll to bottom on load using a ref after content is set.

## Out of scope
- Log search / filtering within the viewer
- Filtering docker layer progress spam (noise in the log is acceptable for now)
- Streaming partial logs for in-progress runs (that's the live deploy panel's job)
- Pagination (files are bounded at ~100KB, fully loading them is fine)
