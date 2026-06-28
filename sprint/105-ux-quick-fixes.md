# Sprint 105 — UX quick fixes (stale timestamp, empty states, session feedback)

**Difficulty:** 2

## Goal

Fix three small but visible UX gaps: the hardcoded "last seen 2h ago" in `ProjectCard`, the missing empty state on the `/logs` page, and the lack of loading feedback on the ops "New conversation" button.

## Reason

These are trust and polish issues. A hardcoded timestamp in an error state tells users the data is stale regardless of reality. A blank `/logs` page with no guidance leaves new users stranded. A silent session reset on "New conversation" leaves users wondering if the click registered. Each is a small fix with an outsized perception impact.

## Context

### ProjectCard stale timestamp
- `apps/dashboard/src/components/project-card.tsx` — the SSH-unreachable error state shows a hardcoded "last seen 2h ago" string. Read the component to find where this is rendered and what data is available. The `status` prop (type `ProjectStatus`) has a `deployedAt` field if available. Use `deployedAt` to compute a real "last seen X ago" string, falling back to "—" if not available. Use the existing `formatDuration` or similar utility if one exists.

### /logs empty state
- `apps/dashboard/app/logs/page.tsx` — when the project list is empty (or before projects load), the page shows nothing or a blank area. Read the file to find the empty branch. Add a simple empty state: an icon, "No projects found", and a link to `/provision` to add one. Look at how other pages render their empty states for the pattern (e.g. the CI page or health page).

### Ops "New conversation" loading state
- `apps/dashboard/app/ops/page.tsx` — the "New conversation" button triggers a session delete + session create + state reset. Read the component to find the handler. Add a loading boolean that disables the button and shows a spinner (or "Resetting..." label) while the async reset is in flight. Use the existing `Skeleton` component or an inline spinner if the project has one.

## Tasks

1. Read `apps/dashboard/src/components/project-card.tsx`. Locate the hardcoded "last seen 2h ago" string. Replace with a computed relative time from `status.deployedAt` (or a comparable field). Fall back to "—".
2. Read `apps/dashboard/app/logs/page.tsx`. Find where projects-empty or initial-load renders. Add an empty state with icon + message + link to `/provision`.
3. Read `apps/dashboard/app/ops/page.tsx`. Find the "New conversation" handler. Add a `resetting` boolean state, disable the button while true, reset it when done.
4. Run `pnpm nx typecheck dashboard --skip-nx-cache`.

## Files involved

- `apps/dashboard/src/components/project-card.tsx` — replace hardcoded timestamp with computed relative time
- `apps/dashboard/app/logs/page.tsx` — add empty state when project list is empty
- `apps/dashboard/app/ops/page.tsx` — add loading state to "New conversation" button

## Acceptance criteria

- [x] ProjectCard SSH-unreachable state shows real "last seen X ago" based on `deployedAt`, not a hardcoded string
- [x] `/logs` page shows an empty state message + link to provision when there are no projects
- [x] Ops "New conversation" button shows a loading/disabled state while the session resets
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Three targeted UX fixes: (1) `project-card.tsx` — replaced the hardcoded "last seen 2h ago" string with a computed value from the existing `deployedAgoStr` variable (derived from `status.deployedAt`), falling back to "—". (2) `logs/page.tsx` — added a styled empty state for the `projects.length === 0` branch: server icon, "No projects found" message, and a `/provision` link. (3) `ops/page.tsx` — added a `resetting` boolean state to `handleNewConversation`, which disables the button and shows "Resetting…" while the async session reset is in flight.

### Files changed
- `apps/dashboard/src/components/project-card.tsx` — replaced hardcoded timestamp with `deployedAgoStr`-based computation
- `apps/dashboard/app/logs/page.tsx` — added empty state block for zero-projects case
- `apps/dashboard/app/ops/page.tsx` — added `resetting` state, disabled button + "Resetting…" label during reset

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Redesigning the ProjectCard error state beyond the timestamp fix
- A full onboarding flow for new users
- Toast feedback after the session reset (that's sprint 104)
