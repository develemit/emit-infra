# UX fixes: SLA mobile stack, DiskDirs empty state, nginx mobile cards, cron command tooltip
**Difficulty:** 2

## Goal
Four small presentation gaps are fixed: the SLA panel stacks on narrow screens, the Storage sub-page never renders blank, the nginx endpoints table has a mobile-friendly layout, and truncated cron commands reveal their full text on hover.

## Reason
The dashboard is often checked from a phone. The opportunity scan (2026-07-02) flagged these as the remaining mobile/empty-state gaps after the sprint 166-168 UX round — all are contained, single-component fixes.

## Context
- Tailwind with `lg:` breakpoint convention throughout; mobile cards + desktop tables is the established split (see `container-table.tsx` for the canonical example).
- `apps/dashboard/src/components/detail/sla-panel.tsx` lines ~32-35: stat tiles in a `flex gap-6` row — overflows narrow screens. Make it `flex-col sm:flex-row` or a responsive grid.
- `apps/dashboard/src/components/detail/disk-dirs-panel.tsx` line ~40: returns `null` when no dirs. On the Storage sub-page (`app/projects/[name]/storage/page.tsx`) this can leave a visually empty region. Render the panel frame with a "No directory data yet" message instead of null (match the empty-state copy style used in `container-table.tsx`: short, `text-subtle font-mono text-[12px]`).
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` lines ~43-47: desktop table with `maxWidth: 260` truncation, no mobile fallback. Add a stacked card layout for `< lg` (path on one line, count/latency below), keep the table for `lg:`.
- `apps/dashboard/src/components/detail/cron-panel.tsx` line ~64: command truncated at `max-w-[320px]` with no `title` attr. Add `title={command}` so the full command shows on hover (same pattern used for nginx paths in sprint 166).

## Tasks
1. SlaPanel: responsive stack for stat tiles.
2. DiskDirsPanel: replace `return null` empty case with framed empty-state message.
3. NginxEndpointsPanel: `lg:` table + mobile card list.
4. CronPanel: `title` tooltip on truncated command cell.
5. Typecheck.

## Files involved
- `apps/dashboard/src/components/detail/sla-panel.tsx`
- `apps/dashboard/src/components/detail/disk-dirs-panel.tsx`
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx`
- `apps/dashboard/src/components/detail/cron-panel.tsx`

## Acceptance criteria
- [x] SLA tiles stack vertically on narrow viewports
- [x] Storage sub-page shows an explanatory empty state when no dir data exists
- [x] Nginx endpoints render as cards below `lg` breakpoint
- [x] Full cron command visible via hover tooltip
- [x] `npx nx run dashboard:typecheck` clean

## Out of scope
- Scroll-shadow hints on `overflow-x-auto` tables (backlog)
- Settings panel error-style consistency (backlog)

## Completed

**Date:** 2026-07-02

### Summary
Executed via Haiku agent (difficulty 2), verified by orchestrator via git diff review + independent typecheck. Four contained presentation fixes: SlaPanel stat tiles now `flex flex-col sm:flex-row gap-6` so they stack on narrow screens; DiskDirsPanel no longer returns `null` when empty — it renders the panel frame with a "No directory data yet" message in the established `text-subtle font-mono text-[12px]` style (also dropped the now-unused `total` reduce and guarded `maxBytes` for the empty case); NginxEndpointsPanel gained a `block lg:hidden` stacked card list (path with `title` tooltip, Requests/Errors/Error Rate below, error-rate coloring preserved) while the existing table is wrapped in `hidden lg:block overflow-x-auto`; CronPanel's truncated command cell got `title={job.command}` for hover reveal.

### Files changed
- `apps/dashboard/src/components/detail/sla-panel.tsx` — responsive stack for stat tiles
- `apps/dashboard/src/components/detail/disk-dirs-panel.tsx` — framed empty state instead of `return null`
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — mobile card list below `lg`, table kept for desktop
- `apps/dashboard/src/components/detail/cron-panel.tsx` — `title` tooltip on truncated command

### Verification
- `npx nx run dashboard:typecheck`: clean (run independently after agent handoff)
- git diff review of all four components against sprint spec: on-spec, no scope creep

### Follow-ups
none
