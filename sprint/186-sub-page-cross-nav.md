# Add sibling navigation between project sub-pages + networking loading skeletons
**Difficulty:** 3

## Goal
From any project sub-page (Storage, Pipelines, Reliability, Data, Admin, Networking) the user can jump directly to any sibling sub-page without returning to the overview, and the Networking sub-page no longer layout-shifts while panels load.

## Reason
The milestone-10 reorganization split the project detail page into six sub-pages, each reachable only from the overview's summary cards. The scan (2026-07-02) flagged the dead-end: deep in Storage, reaching Pipelines takes two navigations. A sibling nav row in the shared shell fixes every sub-page at once.

## Context
- `apps/dashboard/src/components/detail/sub-page-shell.tsx` — shared wrapper for all six sub-pages: renders a back link to the overview, the project name, and a title. All sub-pages pass `name` and `title` props. This is the single place to add sibling nav.
- Sub-pages live at `apps/dashboard/app/projects/[name]/{storage,pipelines,reliability,data,admin,networking}/page.tsx`.
- The overview (`app/projects/[name]/page.tsx`) builds hrefs like `` `${base}/storage` `` where `base = /projects/${encodeURIComponent(name)}`; summary cards there use icons: globe (Networking), database (Storage), zap (Pipelines), shield (Reliability), lock (Data & Secrets), settings (Administration). Reuse the same icon names (see `@/components/icon`).
- Some summary cards are conditionally hidden on the overview (e.g. Networking hidden when `status?.nginxStatus == null`, Data hidden without backup bucket/env keys). For the shell nav keep it simple: always show all six tabs — an empty sub-page is acceptable and the empty-state work from sprint 185 covers Storage; do NOT re-fetch status in the shell just to hide tabs.
- Networking page: `app/projects/[name]/networking/page.tsx` — panels (`ResponseTimePanel`, `CertPanel`, etc.) return `null` until their data resolves, causing layout shift. Add lightweight skeleton blocks (pulsing `bg-card` rounded rectangles, ~2 of them at panel height) shown until the page's initial fetches settle. Follow whatever loading pattern the page already uses for its own state.
- Current page highlighting: use `usePathname()` from `next/navigation` to mark the active tab (`text-fg` active vs `text-subtle` inactive).

## Tasks
1. Read `sub-page-shell.tsx` and the six sub-pages to confirm the props contract.
2. Add a horizontal nav row (icon + label, `overflow-x-auto` for mobile) to SubPageShell linking all six siblings, active tab highlighted via pathname.
3. Verify each sub-page renders the nav correctly (no double-title, spacing consistent).
4. Add loading skeletons to the networking page while initial data loads.
5. Typecheck.

## Files involved
- `apps/dashboard/src/components/detail/sub-page-shell.tsx` — sibling nav row
- `apps/dashboard/app/projects/[name]/networking/page.tsx` — skeletons
- (verify only) other five sub-page files

## Acceptance criteria
- [x] All six sub-pages show a sibling nav with the current page highlighted
- [x] Nav scrolls horizontally on mobile rather than wrapping/overflowing
- [x] Networking page shows skeletons instead of empty space during load
- [x] `npx nx run dashboard:typecheck` clean

## Out of scope
- Conditional tab hiding based on project capabilities
- Cmd+K palette (sprint 187)

## Completed

**Date:** 2026-07-02

### Summary
SubPageShell (now `'use client'`) gained a horizontal sibling nav row below the header: all six sub-pages listed with icon + label, `overflow-x-auto` + `whitespace-nowrap` for mobile scrolling, active tab marked via `usePathname()` (`text-fg` + `border-fg` underline + `aria-current="page"`; inactive `text-subtle border-transparent`). All tabs always shown per spec — no capability-based hiding, no status re-fetch in the shell. Since all six sub-pages render through the shell, the nav landed everywhere in one change with no per-page edits.

Two notes beyond the letter of the spec: (1) the `lock` and `settings` icon names referenced by the overview summary cards (and now the nav) did not exist in `icon.tsx` — they rendered as empty SVGs. Added both paths (feather-style) so the icons actually draw. (2) Discovered the entire milestone-10 reorg (six sub-pages, shell, summary cards, slimmed overview) was sitting uncommitted from a prior session; committed it as its own scoped commit (`0a4451c`) before starting this sprint so sprint 186's commit stays clean. The fleet/home incremental-loading diffs (`app/page.tsx`, `app/health/page.tsx`) are unrelated and remain uncommitted.

Networking page: added a `loading` gate (`metricsLoading || !nginxSettled`, where nginxSettled flips in the fetch's `finally`) that renders two pulsing `h-[180px] rounded-xl bg-card border border-border animate-pulse` skeleton blocks inside the shell until initial fetches settle — same skeleton style as the logs page.

### Files changed
- `apps/dashboard/src/components/detail/sub-page-shell.tsx` — sibling nav row with pathname-based active state
- `apps/dashboard/app/projects/[name]/networking/page.tsx` — loading skeletons until metrics + nginx fetches settle
- `apps/dashboard/src/components/icon.tsx` — added missing `lock` and `settings` icon paths

### Verification
- `npx nx run dashboard:typecheck`: clean
- Grep confirms all six sub-pages render through SubPageShell (single title source, nav uniform)
- Nav markup: `overflow-x-auto` + `whitespace-nowrap` (scrolls, never wraps); active tab `aria-current` + `text-fg`

### Follow-ups
- `[defer]` uncommitted fleet/home incremental status loading refactor in `app/page.tsx` + `app/health/page.tsx` (prior session work, complete and typechecking) still needs review/commit — possibly belongs to an upcoming sprint
