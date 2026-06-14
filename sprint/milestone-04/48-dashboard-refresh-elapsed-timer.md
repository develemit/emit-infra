# Sprint 48 — Project Detail: Refresh Button + Dynamic Elapsed Timer
**Difficulty:** 2

## Goal
Add a manual refresh button and a live "polled Xs ago" counter to the project detail page so users can immediately re-poll after a deploy instead of waiting 30 seconds.

## Reason
After clicking Deploy, the operator wants to confirm the new build number appeared — but the next auto-poll could be up to 30 seconds away. A refresh button closes that gap. The static "polled 30s ago" string is also misleading (it never changes between polls), so replacing it with actual elapsed time gives honest feedback.

## Context
`apps/dashboard/app/projects/[name]/page.tsx` owns the polling loop. It fetches data in `fetchData()` and runs `setInterval(() => void fetchData(), 30_000)`. The result is passed to `HealthCard` via `<HealthCard ... polledAgo="polled 30s ago" />` — the string is hardcoded.

`apps/dashboard/src/components/detail/health-card.tsx` renders the `polledAgo` prop in a small chip in the card header (lines 91–99). It also renders an `<Icon name="refresh" />` inside that chip but it's purely decorative.

Strategy:
1. Track `lastPolledAt: number` (epoch ms, updated at end of each `fetchData()` call) in the detail page.
2. Use a 1-second `setInterval` to format it as "just now / Xs ago / Xm ago" and pass the string down.
3. Wire the existing refresh icon chip as a clickable button that calls `fetchData()`.
4. `HealthCard` already accepts `polledAgo?: string` — no signature change needed, just make the chip a `<button>`.

## Tasks
1. Read `apps/dashboard/app/projects/[name]/page.tsx` in full.
2. Add `const [lastPolledAt, setLastPolledAt] = useState<number>(0)` to the page state.
3. In `fetchData`, after all three parallel calls resolve, call `setLastPolledAt(Date.now())`.
4. Add a `useEffect` that ticks every 1 second and formats elapsed time into a local `polledAgo` string:
   - 0–3s → `"just now"`
   - 4–59s → `"Xs ago"`
   - 60s+ → `"Xm ago"`
5. Pass the live `polledAgo` string and a `onRefresh={fetchData}` prop to `HealthCard`.
6. Read `apps/dashboard/src/components/detail/health-card.tsx`.
7. Add `onRefresh?: () => void` to `HealthCardProps`.
8. Wrap the existing polledAgo chip `<span>` in a `<button>` (or keep it as a span and add a separate small refresh icon button next to it) — whichever is cleaner. The button calls `onRefresh?.()`.
9. Run `pnpm nx run dashboard:typecheck` (or equivalent) to confirm clean.

## Files involved
- `apps/dashboard/app/projects/[name]/page.tsx` — add `lastPolledAt` state, 1s tick effect, `onRefresh` prop
- `apps/dashboard/src/components/detail/health-card.tsx` — add `onRefresh?` prop, make chip interactive

## Acceptance criteria
- [x] Clicking the polled-ago chip/button immediately re-fetches data (no waiting for the 30s interval)
- [x] The elapsed display updates each second and reads "just now / Xs ago / Xm ago"
- [x] Auto-poll still fires every 30s unchanged
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-12

### Summary
Added `lastPolledAt` and `polledAgo` state to the project detail page. `fetchData` now calls `setLastPolledAt(Date.now())` after all three parallel API calls resolve. A 1-second `setInterval` effect formats the elapsed time into "just now / Xs ago / Xm ago" and stores it in `polledAgo`. Added `onRefresh?: () => void` to `HealthCardProps` and converted the decorative polledAgo chip from a `<span>` to a `<button>` that calls `onRefresh?.()` on click.

### Files changed
- `apps/dashboard/app/projects/[name]/page.tsx` — added `lastPolledAt` + `polledAgo` state, 1s tick effect, pass live `polledAgo` and `onRefresh={fetchData}` to HealthCard
- `apps/dashboard/src/components/detail/health-card.tsx` — added `onRefresh?` prop, converted chip to interactive button

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- Debouncing the manual refresh (keep it simple)
- Showing a spinner on the HealthCard during the refresh (separate concern)
