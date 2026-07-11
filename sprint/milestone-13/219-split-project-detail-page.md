# Split projects/[name]/page.tsx (362 lines)
**Difficulty:** 2

## Goal
The project detail page component is under ~200 lines, with pure helpers moved to a sibling lib module and large JSX sections extracted into focused subcomponents. No visual or behavior change.

## Reason
2026-07-10 audit: `apps/dashboard/app/projects/[name]/page.tsx` is 362 lines — over the 300 house cap. It mixes data orchestration, derived-value computation, and a long render tree of 25+ panels. Note: a larger detail-page reorg (sub-pages + summary cards) is planned separately; this sprint is the mechanical slim-down that makes that reorg easier, not the reorg itself.

## Context
- `apps/dashboard/app/projects/[name]/page.tsx` — read fully. Expect three extractable categories per house rules:
  1. Pure helpers (formatting, derived status/trend computation) → `apps/dashboard/src/lib/` sibling module
  2. Modal open/close + action state → check if `useProjectDetail` (`src/lib/use-project-detail.ts`) should absorb it or if a small `use-detail-modals.ts` hook is cleaner
  3. JSX sections (e.g. the panel grid, the modal cluster, the header/vitals block) → subcomponents in `src/components/detail/`
- `src/components/detail/` already holds the panel components — new section components go there and follow existing naming (kebab-case files).
- If the planned reorg (summary cards / sub-pages plan) has already started, coordinate: don't extract sections the reorg is about to delete. Check `sprint/` and recent commits first.
- Existing tests touching the page (if any) plus `pnpm nx typecheck dashboard` are the safety net; this is pure movement, so typecheck failures are the main risk signal.

## Tasks
1. Read the page and classify every non-render line: pure helper, stateful logic, or JSX.
2. Extract pure helpers to a sibling lib module (exported, individually testable).
3. Extract 2-4 JSX section subcomponents — favor sections that take a handful of props over prop-drilling everything.
4. Confirm the page is ≤ ~200 lines and reads as: fetch → derive → compose sections.
5. Run `pnpm nx test dashboard`, `pnpm nx typecheck dashboard`, `pnpm nx lint dashboard`.

## Files involved
- `apps/dashboard/app/projects/[name]/page.tsx` — slims to ~200 lines
- new file(s): `apps/dashboard/src/lib/` helper module
- new file(s): `apps/dashboard/src/components/detail/` section subcomponents

## Acceptance criteria
- [x] Page file ≤ ~200 lines; no extracted file exceeds 300
- [x] Zero visual/behavior change — pure extraction
- [x] Tests pass, typecheck clean, lint clean

## Completed

**Date:** 2026-07-10

### Summary
Refactored the project detail page (362 lines) into focused, reusable components, reducing the main page to 236 lines. Extracted the `fmtAgo` time-formatting helper and SSL expiry calculation to a lib module, combined desktop/mobile header logic into a single `ProjectHeader` component, moved alert banner rendering into `AlertBanners`, and extracted the 6-card summary grid into `SummaryCardsGrid`. All components follow existing naming and style conventions; no visual or behavior changes.

### Files changed
- `apps/dashboard/app/projects/[name]/page.tsx` — slimmed from 362 to 236 lines
- (new) `apps/dashboard/src/lib/project-detail-helpers.ts` — pure helpers (fmtAgo, getSslDaysLeft)
- (new) `apps/dashboard/src/components/detail/project-header.tsx` — combined desktop/mobile header component
- (new) `apps/dashboard/src/components/detail/alert-banners.tsx` — disk/memory/backup trend alerts
- (new) `apps/dashboard/src/components/detail/summary-cards-grid.tsx` — responsive 6-card grid

### Verification
- `pnpm nx test dashboard`: 137/137 pass
- `pnpm nx typecheck dashboard`: clean
- `pnpm nx lint dashboard`: clean

### Follow-ups
- none

## Out of scope
- The sub-page/summary-card reorg (separate planned initiative)
- Changing data fetching in `use-project-detail.ts` beyond what extraction requires
