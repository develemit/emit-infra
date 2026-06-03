# Sprint 14 — Dashboard error boundaries

> _Promoted from sprint-03 follow-ups, 2026-06-03._

## Goal
Add Next.js App Router error boundaries to the dashboard so API failures show a recoverable error state instead of a blank page or uncaught exception.

## Context
- Builds on sprint 03 (dashboard scaffold) and sprint 06 (design tokens).
- `apps/dashboard/app/page.tsx` calls `getProjects()` in a 30s polling loop. If the API is unreachable on first load, React throws and the page goes blank with no recovery path.
- Next.js App Router supports `error.tsx` files co-located with `page.tsx` — these become React error boundaries automatically. They receive `{ error, reset }` props; calling `reset()` re-renders the page.
- Design tokens for error state: `var(--err)`, `var(--err-soft)`, `var(--err-line)` (from `globals.css`); Icon `alert` (from `icon.tsx`).
- Keep error boundaries minimal — a centered callout with icon, message, and Retry button. Don't try to recover data or persist errors.

## Tasks

1. **Create `apps/dashboard/app/error.tsx`** — global error boundary:
   - `'use client'`
   - Accept `{ error, reset }: { error: Error; reset: () => void }`
   - Render: centered flex column, alert icon in `var(--err)` color, "Something went wrong" heading, `error.message` in monospace 12px, "Retry" button that calls `reset()`.
   - Style using design tokens: outer wrapper `bg-err-soft border border-err-line rounded-xl`, icon `text-err`.

2. **Create `apps/dashboard/app/projects/[name]/error.tsx`** — detail page error boundary:
   - Same structure as above.
   - Instead of "Retry" only, show both "Retry" and a "Back to projects" link (`← Projects`, href `/`).

## Files involved
- (new) `apps/dashboard/app/error.tsx` — global error boundary
- (new) `apps/dashboard/app/projects/[name]/error.tsx` — detail page error boundary

## Completed

**Date:** 2026-06-03

### Summary
Created two minimal `error.tsx` boundaries using Next.js App Router's built-in error boundary convention. Both render a centered card with `var(--err-soft)` background, `var(--err-line)` border, an alert icon in `var(--err)`, a heading, the error message in monospace, and action buttons. The detail page boundary adds a "← Projects" link to allow navigation back without losing the overview. Both files are `'use client'` as required.

### Files changed
- (new) `apps/dashboard/app/error.tsx` — global error boundary with Retry button
- (new) `apps/dashboard/app/projects/[name]/error.tsx` — detail page error boundary with Retry + Back to projects

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Code inspection: both files export default function, `'use client'`, accept `{ error: Error; reset: () => void }`, use design tokens

### Follow-ups
none

## Acceptance criteria
- [x] When `getProjects()` throws, the overview page shows an error state with a Retry button instead of a blank page
- [x] When the project detail API call throws, the detail page shows an error state with Retry and Back links
- [x] Error boundaries use design tokens (err-soft background, err border) matching the design system
- [x] `pnpm typecheck` and `pnpm lint` pass
