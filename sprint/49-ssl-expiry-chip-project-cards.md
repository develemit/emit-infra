# Sprint 49 — SSL Expiry Warning Chip on Home Project Cards
**Difficulty:** 2

## Goal
Surface SSL expiry warnings on the home-page project grid so operators notice an expiring cert without having to click into each project.

## Reason
`sslExpiry` is already fetched in every status poll and shown in the project detail HealthCard — but the home-page ProjectCard drops it on the floor. A cert expiring in 3 days is invisible at the grid level. Adding a small chip (yellow < 14 days, red if expired) costs zero new API work and uses logic that already exists in HealthCard.

## Context
`apps/dashboard/src/components/project-card.tsx` receives `status: ProjectStatus | null`. `ProjectStatus` already has `sslExpiry?: string | null`.

`apps/dashboard/src/components/detail/health-card.tsx` has a `sslDaysLeft(expiry)` helper (lines 30–38) that returns `{ value: string; color?: string }`. Extract or duplicate this helper into the ProjectCard (duplication is fine given the small size).

The card footer currently shows uptime (left) and container count (right). The SSL chip fits naturally in the `<div className="flex gap-1.5">` region badge row (line 47) when expiry is imminent, or as a standalone row below if you prefer.

## Tasks
1. Read `apps/dashboard/src/components/project-card.tsx` in full.
2. Copy the `sslDaysLeft` helper from `health-card.tsx` (or inline equivalent logic) into `project-card.tsx`.
3. Compute `const ssl = sslDaysLeft(status?.sslExpiry)`.
4. Render the chip only when expiry ≤ 30 days (no chip when cert is healthy or unknown):
   ```tsx
   {status?.sslExpiry && ssl.days <= 30 && (
     <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: ssl.color, background: 'var(--card-2)', border: '1px solid var(--border)' }}>
       SSL {ssl.value}
     </span>
   )}
   ```
   Place it in the region badge row or the footer — whichever preserves the card height.
5. Adjust `sslDaysLeft` to return the raw `days` number alongside `value` + `color` so the render condition `<= 30` is easy.
6. Confirm no typecheck errors.

## Files involved
- `apps/dashboard/src/components/project-card.tsx` — add `sslDaysLeft` helper + conditional chip

## Acceptance criteria
- [x] Cards with SSL expiry > 30 days show no SSL chip
- [x] Cards with SSL expiry 14–30 days show a neutral/muted SSL chip
- [x] Cards with SSL expiry < 14 days show a yellow warning chip
- [x] Cards with expired certs show a red chip reading "Expired"
- [x] Cards with `sslExpiry: null` show nothing (no chip, no crash)
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
Added a `sslDaysLeft` helper to `project-card.tsx` that mirrors the logic in `health-card.tsx` but also returns the raw `days` number. The chip renders in the region badge row only when `ssl.days <= 30`, keeping the card height unchanged for healthy certs. Color coding matches HealthCard: yellow (`--warn`) for < 14 days, red (`--err`) for expired.

### Files changed
- `apps/dashboard/src/components/project-card.tsx` — added `sslDaysLeft` helper + conditional SSL chip in region badge row

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- Clicking the chip (no action needed — it's informational)
- Showing SSL status in mobile vs desktop differently (same treatment for both)
