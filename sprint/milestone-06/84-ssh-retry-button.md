# SSH retry button on unreachable project cards
**Difficulty:** 2

## Goal
When a project card shows the "SSH unreachable" error state, add a small "Retry" button that immediately re-polls that project's status without waiting for the 30-second interval.

## Reason
The home page polls every 30 seconds. If a project just came back online, or if you want to confirm a server is truly unreachable, you're currently stuck waiting up to 30 seconds. A retry button closes this loop instantly and avoids the "is it still down?" guessing game.

## Context
- `apps/dashboard/app/page.tsx` — `HomePage` owns `statuses` state and the `fetchAll` function. It renders `<ProjectCard project={p} status={statuses[p.config.name] ?? null} />`. The `fetchAll` function refreshes all projects at once.
- `apps/dashboard/src/components/project-card.tsx` — `ProjectCard` renders the unreachable state at line ~143: a red `<div>` with "SSH unreachable — last seen 2h ago". This is where the Retry button lives.
- The card should NOT own the fetch logic (the parent owns statuses). So `ProjectCard` needs a new optional prop `onRetry?: () => void`. When provided and the card is in the unreachable state, render a "Retry" button inside the error div that calls `onRetry()`.
- In `page.tsx`, pass `onRetry` as a callback that calls `getStatus(name)` and patches just that project's entry in `statuses`. Don't call `fetchAll` (that re-fetches everything). Instead: `() => getStatus(p.config.name).then(s => setStatuses(prev => ({ ...prev, [p.config.name]: s })))`.
- The "Retry" button should show a loading spinner (or just disable itself) while the request is in flight to prevent double-clicks. Use a `retrying` boolean state in the callback closure — or a local `useState` in the card if `onRetry` returns a Promise.
- Simplest approach: `onRetry` returns `Promise<void>`, card tracks `const [retrying, setRetrying] = useState(false)` locally.

## Tasks
1. In `project-card.tsx`, add `onRetry?: () => Promise<void>` to `Props`.
2. Add `const [retrying, setRetrying] = useState(false)` inside `ProjectCard`.
3. In the unreachable error div, append a `<button>` that: sets `retrying = true`, awaits `onRetry?.()`, sets `retrying = false`. Show a spinner (or the text "…") while retrying; show "Retry" otherwise. Disable while `retrying`.
4. In `page.tsx`, pass `onRetry` to each `<ProjectCard>`:
   ```tsx
   onRetry={async () => {
     const s = await getStatus(p.config.name).catch(() => ({ error: 'unreachable' } as ProjectStatus))
     setStatuses(prev => ({ ...prev, [p.config.name]: s }))
   }}
   ```
5. Style the button to fit inside the existing red error bar — small, monospace, with `ml-auto` to push it right.

## Files involved
- `apps/dashboard/src/components/project-card.tsx` — add `onRetry` prop + retry button in unreachable state
- `apps/dashboard/app/page.tsx` — pass `onRetry` to `ProjectCard`

## Acceptance criteria
- [x] "Retry" button appears on project cards that are in the unreachable state
- [x] Clicking Retry immediately re-polls that project's status and updates the card
- [x] Button shows loading state while the request is in flight
- [x] If retry succeeds (project is reachable), card transitions to healthy state
- [x] If retry fails, card remains in unreachable state
- [x] Healthy project cards show no retry button
- [x] `pnpm typecheck` passes

## Completed

**Date:** 2026-06-20

### Summary
Added `onRetry?: () => Promise<void>` to `ProjectCard`'s Props and a local `retrying` boolean state. The retry button renders inside the red unreachable error bar with `ml-auto` to push it right, shows "…" and is disabled while the request is in flight, and reverts to "Retry" on completion. In `page.tsx`, the callback calls `getStatus(name)` with a catch fallback and patches only that project's entry in `statuses` — no full re-fetch.

### Files changed
- `apps/dashboard/src/components/project-card.tsx` — `onRetry` prop, `retrying` state, retry button in unreachable div
- `apps/dashboard/app/page.tsx` — passes `onRetry` to each `ProjectCard`

### Verification
- `pnpm typecheck` (dashboard): clean

### Follow-ups
none

## Out of scope
- Retry on the detail page (separate page, lower priority)
- Automatic retry with backoff
- "Last seen X ago" dynamic timestamp (currently static)
