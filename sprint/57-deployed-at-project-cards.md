# Sprint 57 — Deployed-At Chip on Home-Page Project Cards
**Difficulty:** 2

> _Promoted from sprint-51 out-of-scope, 2026-06-13._

## Goal
Show "deployed Xh ago" on the home-page project grid cards using the `deployedAt` epoch already returned by the status API.

## Reason
Sprint 51 added a "Deployed" StatTile to the project detail HealthCard. The home-page cards already carry `status: ProjectStatus | null` which now includes `deployedAt`. Surfacing "deployed 2h ago" on the card grid gives operators a time-since-deploy signal without navigating into each project — especially useful after a batch deploy.

## Context
`apps/dashboard/src/components/project-card.tsx` (currently ~104 lines):
- Receives `status: ProjectStatus | null`
- `ProjectStatus` already has `deployedAt?: string | null`
- Already has a `sslDaysLeft` helper (sprint 49) that returns `{ value, color, days }`
- The card footer row shows uptime (left) and container count (right); there's room to add a chip alongside the SSL chip in the region badge row, or as a third footer item

Add a `deployedAgo(epoch: string | null | undefined): string` helper (same logic as in `health-card.tsx`, lines ~30–38 post-sprint-51):
```ts
function deployedAgo(epoch: string | null | undefined): string {
  if (!epoch) return ''
  const secs = Math.floor(Date.now() / 1000) - parseInt(epoch, 10)
  if (isNaN(secs) || secs < 0) return ''
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}
```

Return empty string (not '—') when unknown so the chip renders nothing and doesn't add clutter.

Render position: place a small chip in the region badge row (`<div className="flex gap-1.5">`) alongside the region badge and SSL chip. Only render when `deployedAgoStr` is non-empty:
```tsx
{deployedAgoStr && (
  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded text-subtle"
    style={{ background: 'var(--card-2)', border: '1px solid var(--border)' }}>
    {deployedAgoStr}
  </span>
)}
```

## Tasks
1. Read `apps/dashboard/src/components/project-card.tsx` in full.
2. Add `deployedAgo` helper function (return `''` for null/unknown, not `'—'`).
3. Compute `const deployedAgoStr = deployedAgo(status?.deployedAt)`.
4. Render the chip in the region badge row only when non-empty.
5. Run `pnpm nx run dashboard:typecheck`.

## Files involved
- `apps/dashboard/src/components/project-card.tsx` — add `deployedAgo` helper + conditional chip

## Acceptance criteria
- [x] Cards show "Xm ago / Xh ago / Xd ago / just now" when `deployedAt` is set
- [x] Cards show no chip when `deployedAt` is null or missing (no '—', no crash)
- [x] Card height is unchanged for projects without a deployed timestamp
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
Added `deployedAgo(epoch)` helper to `project-card.tsx` (same logic as the one in `health-card.tsx` from sprint 51). Computed `deployedAgoStr` in the component and rendered a small mono chip in the region badge row alongside the SSL chip. The chip only renders when the string is non-empty, so cards without a deploy timestamp are visually unchanged.

### Files changed
- `apps/dashboard/src/components/project-card.tsx` — added `deployedAgo` helper + conditional chip in region badge row (120 lines total)

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- Showing deploy history (more than one timestamp)
- Click-to-view deploy log from the card
