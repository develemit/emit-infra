# Sprint 181 — UX polish: mobile restart confirm + settings error clear

> _Promoted from sprint-167 and sprint-168 follow-ups, 2026-07-02._

## Goal
Add a restart confirmation to MobileContainerRow and make settings validation errors clear when the user edits the field.

## Context
Two small UX gaps identified in sprints 167 and 168:

1. **MobileContainerRow restart**: `apps/dashboard/src/components/detail/container-row.tsx` — the desktop row got a restart confirmation dialog in sprint 167, but the mobile row still fires restart immediately on tap. Apply the same confirm pattern.
2. **Settings validation error**: `apps/dashboard/src/components/detail/project-settings-panel.tsx` — validation errors (e.g. "domain must not be empty") are set on save but don't clear when the user starts editing the field. The error persists until the next save attempt. Clear errors `onChange` for the relevant field.

## Tasks
1. Read `container-row.tsx` and find the MobileContainerRow restart handler.
2. Add the same confirmation pattern used in the desktop row (inline confirm state, "Restart?" → "Yes" / "Cancel").
3. Read `project-settings-panel.tsx` and find the validation error state.
4. Clear the relevant error when the user changes the input value (`onChange` or `onInput`).
5. Typecheck.

## Acceptance criteria
- [x] MobileContainerRow shows a confirm step before restarting a container
- [x] Editing a settings field clears any validation error for that field
- [x] Typecheck passes

## Completed

**Date:** 2026-07-02

### Summary
Added inline restart confirmation to `MobileContainerRow`: tapping the refresh icon now sets `confirmRestart: true` showing Confirm/Cancel text buttons; only on Confirm does the actual restart fire. This matches the desktop row's confirm pattern (though implemented inline rather than via parent props, since the mobile row manages its own state). Also cleared `domainError` and `envKeysError` in `project-settings-panel.tsx` on their respective field `onChange` handlers so stale validation messages disappear as soon as the user begins correcting the input.

### Files changed
- `apps/dashboard/src/components/detail/container-row.tsx` — added `confirmRestart` state, confirm/cancel UI in MobileContainerRow
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — clear domain and envKeys errors on field change

### Verification
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
none
