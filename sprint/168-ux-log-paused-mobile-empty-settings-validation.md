# UX: Log Paused Indicator, Mobile Container Empty State, Settings Client Validation
**Difficulty:** 2

## Goal
Show a visible "paused" banner when log auto-follow stops, guard the mobile container section against empty state, and validate Settings form fields client-side before hitting the API.

## Reason
When a user scrolls up in the log viewer, auto-follow stops silently — there's no indicator, so it's unclear if logs are live or frozen. On mobile, the container card section maps over `sorted` with no empty guard, rendering a blank area when no containers exist. The Settings form submits invalid data and only fails after a round-trip, which is slower and less helpful than inline feedback.

## Context
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — the log page uses a scroll listener to control auto-follow. Add an `isFollowing` boolean state (true when scroll is pinned to bottom). When `!isFollowing`, render a fixed/sticky banner: "Live paused — scroll to bottom to resume". The banner should disappear when auto-follow resumes.
- `apps/dashboard/src/components/detail/container-table.tsx` ~line 134: the mobile view maps over `sorted` (the sorted container list). There's already a desktop empty state at ~line 84 (`"No containers found"`). Add the same guard before the mobile map: `if (sorted.length === 0) return <p>No containers found.</p>` (match existing copy and style).
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — the save handlers call `updateProjectConfig` immediately. Add pre-flight validation:
  - `domain`: reject if it doesn't match `/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/` or is empty when provided
  - `requiredEnvKeys` items: each must match `/^[A-Z_][A-Z0-9_]*$/`
  - Show an inline error string below the field if invalid; skip the API call

## Tasks
1. In `logs/page.tsx`, add `isFollowing` state. Use a scroll event listener on the log container: set `isFollowing = true` when `scrollTop + clientHeight >= scrollHeight - 10`, `false` otherwise. Render a sticky "Live paused — scroll to bottom to resume" bar when `!isFollowing`.
2. In `container-table.tsx`, add an empty-state guard before the mobile card map to match the existing desktop empty state.
3. In `project-settings-panel.tsx`, add inline validation for `domain` and `requiredEnvKeys` fields before calling the API. Show an error string below the input on failure.
4. Typecheck.

## Files involved
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — add isFollowing state and paused indicator banner
- `apps/dashboard/src/components/detail/container-table.tsx` — add mobile empty-state guard
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — add client-side field validation before save

## Acceptance criteria
- [x] Scrolling up in the log page shows a visible paused indicator
- [x] Scrolling to the bottom hides the paused indicator
- [x] Mobile view with zero containers shows "No containers found" (not a blank section)
- [x] Entering an invalid domain in Settings shows an inline error without calling the API
- [x] Entering an invalid env key (e.g. lowercase) shows an inline error without calling the API
- [x] Typecheck passes

## Out of scope
- Full form validation library (Zod client-side, React Hook Form, etc.)
- Validating every settings field — domain and envKeys only
- Persisting the "paused" preference across sessions

## Completed

**Date:** 2026-07-01

### Summary
Three independent UX fixes. Logs page: added `isFollowing` state tracked via a capture-phase scroll listener on the terminal wrapper div (necessary because the Terminal component's scroll container is internal and doesn't bubble scroll events). A "Live paused" badge appears as an absolute overlay at the bottom when scrolled up. Mobile containers: added an empty-state guard before the mobile card map matching the existing desktop copy. Settings panel: added `domainError` and `envKeysError` state; validation fires in the save handlers before the API call and renders inline error messages below the respective fields.

### Files changed
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — added isFollowing state, capture-phase scroll listener, paused indicator overlay
- `apps/dashboard/src/components/detail/container-table.tsx` — added mobile empty-state guard
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — added domain and envKeys client-side validation with inline error display

### Verification
- typecheck: clean (all 5 packages pass)

### Follow-ups
- `[defer]` Settings validation clears the error on successful save but doesn't reset when the user edits the field (error stays until next save attempt) — minor UX refinement
