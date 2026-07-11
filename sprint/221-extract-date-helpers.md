# Extract lib/date-helpers.ts and remove duplicate time/SSL formatters
**Difficulty:** 1

## Goal
One `apps/dashboard/src/lib/date-helpers.ts` module exports the shared time/SSL formatting helpers; the duplicate implementations in components and hooks are deleted and import from it. Zero behavior change.

## Reason
2026-07-11 audit: `sslDaysLeft` and `deployedAgo` are defined in both `health-card.tsx` and `project-card.tsx`, and they have **already drifted** — project-card's `sslDaysLeft` returns an extra `days` field. Relative-time formatting (`formatTime`) is reimplemented ~5 times. Small mechanical fix that stops the drift.

## Context
- Duplicate sites (verified):
  - `apps/dashboard/src/components/detail/health-card.tsx:30` `sslDaysLeft` → `{ value, color? }`
  - `apps/dashboard/src/components/project-card.tsx:38` `sslDaysLeft` → `{ value, color?, days }` (superset — use this as the canonical signature; health-card just ignores `days`)
  - `health-card.tsx:53` and `project-card.tsx:49` — `deployedAgo`
  - `apps/dashboard/src/lib/use-ops-chat.ts:28` — `formatTime` (h/d "ago" formatting)
  - `apps/dashboard/src/components/` `ci-timeline.tsx`, `deploy-timeline.tsx`, and `apps/dashboard/src/lib/full-chart-helpers.ts` — grep for `formatTime`/ago-style formatting and compare before unifying
- Compare each implementation body before merging: if two "formatTime" variants genuinely differ (e.g. minutes granularity vs hours), export two clearly named functions rather than forcing one — but identical logic must collapse to one export.
- House rules: boring names (`formatAgo`, `sslDaysLeft`), no comments needed, pure functions.
- Add a small `date-helpers.test.ts` — these are pure functions, cheap to pin (thresholds: just now / Nh ago / Nd ago; SSL expiring soon color; null/undefined inputs).
- `full-chart-helpers.ts` already has a test file — keep it passing if you move anything out of it.

## Tasks
1. Grep all formatter duplicates; diff the bodies to identify true duplicates vs distinct-on-purpose variants.
2. Create `lib/date-helpers.ts` with the canonical implementations (superset signatures).
3. Replace all duplicate definitions with imports; delete the locals.
4. Write `date-helpers.test.ts` covering thresholds and null handling.
5. Run `pnpm nx test dashboard`, `pnpm nx typecheck dashboard`, `pnpm nx lint dashboard`.

## Files involved
- new file: `apps/dashboard/src/lib/date-helpers.ts` + `date-helpers.test.ts`
- `apps/dashboard/src/components/detail/health-card.tsx` — delete local helpers, import
- `apps/dashboard/src/components/project-card.tsx` — same
- `apps/dashboard/src/lib/use-ops-chat.ts` — delete `formatTime`, import
- `apps/dashboard/src/components/ci-timeline.tsx`, `deploy-timeline.tsx`, `apps/dashboard/src/lib/full-chart-helpers.ts` — replace if truly duplicate

## Acceptance criteria
- [x] `sslDaysLeft`/`deployedAgo`/`formatTime` each defined exactly once in the dashboard
- [x] Rendered output unchanged (same strings/colors for same inputs)
- [x] Helpers unit-tested; tests pass, typecheck clean, lint clean

## Completed

**Date:** 2026-07-11

### Summary
Created `apps/dashboard/src/lib/date-helpers.ts` consolidating all date/time formatters (`sslDaysLeft`, `deployedAgo`, `formatAgo`, `formatTimestamp`, `formatTimeLabel`, `formatTooltipTime`). Removed duplicate implementations from 8 files (health-card, project-card, use-ops-chat, ci-timeline, deploy-timeline, full-chart-helpers, network-chart, full-chart). All 10 call sites updated to import from the central module. One behavior-preserving fix in project-card.tsx to handle new `deployedAgo()` return format.

### Files changed
- (new) `apps/dashboard/src/lib/date-helpers.ts` — centralized date formatters
- (new) `apps/dashboard/src/lib/date-helpers.test.ts` — 21 tests covering formatters and thresholds
- `apps/dashboard/src/components/detail/health-card.tsx` — deleted local helpers, import from lib
- `apps/dashboard/src/components/project-card.tsx` — deleted local helpers, import from lib, fixed conditional logic
- `apps/dashboard/src/lib/use-ops-chat.ts` — deleted `formatTime`, import from lib
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — deleted local formatter, import
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — deleted local formatter, import
- `apps/dashboard/src/components/detail/full-chart-helpers.ts` — deleted local formatters, import
- `apps/dashboard/src/components/detail/network-chart.tsx` — deleted local formatter, import
- `apps/dashboard/src/components/detail/full-chart.tsx` — updated import
- `apps/dashboard/src/components/detail/full-chart-helpers.test.ts` — updated import

### Verification
- `pnpm nx test dashboard`: 166/166 pass (21 new in date-helpers.test.ts)
- `pnpm nx typecheck dashboard`: clean
- `pnpm nx lint dashboard`: clean

### Follow-ups
none

## Out of scope
- Changing any display format or thresholds
- The use-ops-chat split (sprint 224) — only swap its `formatTime` import here
