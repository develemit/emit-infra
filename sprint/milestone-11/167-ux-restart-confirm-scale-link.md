# UX: Container Restart Confirmation + Scale Advice Link
**Difficulty:** 2

## Goal
Add an inline confirmation step before restarting a container, and make the scale-advice chip scroll to the Settings panel.

## Reason
Clicking "Restart" in the container table fires immediately with no confirmation — a misclick on a production container causes instant downtime. The scale advice chip tells the user to upgrade their server tier but clicking it does nothing, so the nudge has no actionable path from the health card to the settings where the server type is configured.

## Context
- `apps/dashboard/src/components/detail/container-table.tsx` lines ~58–73: the restart button calls the API on click. Add `confirmRestart: string | null` state (null = no pending confirm, string = container name awaiting confirmation). On "Restart" click, set `confirmRestart` instead of calling the API. Render inline Confirm/Cancel when the state matches the row's container name.
- `apps/dashboard/src/components/detail/container-row.tsx` — check how `onRestart` is currently threaded; the row may need an `isConfirming` prop to show inline confirm controls, or the confirm UI can live in the table row wrapper.
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — add `id="settings"` to the outermost wrapper element if not already present. This is the scroll target.
- `apps/dashboard/src/components/detail/health-card.tsx` — the scale advice chip is rendered below the resource meters. Wrap it in an `<a href="#settings">` anchor so clicking scrolls to the settings panel. No JS needed — browser native anchor scroll is sufficient.

## Tasks
1. Read `container-table.tsx` and `container-row.tsx` to understand the current restart flow.
2. In `container-table.tsx`, add `confirmRestart: string | null` state. Change the restart button onClick to set state rather than call the API.
3. For the row whose container name matches `confirmRestart`, render "Confirm" and "Cancel" buttons inline. "Confirm" calls the API and clears state; "Cancel" clears state.
4. In `project-settings-panel.tsx`, add `id="settings"` to the outermost element if missing.
5. In `health-card.tsx`, wrap the scale advice chip in `<a href="#settings">`.
6. Typecheck.

## Files involved
- `apps/dashboard/src/components/detail/container-table.tsx` — add confirmRestart state and inline confirm/cancel UI
- `apps/dashboard/src/components/detail/container-row.tsx` — may need props to render confirm controls (check existing interface)
- `apps/dashboard/src/components/detail/health-card.tsx` — wrap scale advice chip with `<a href="#settings">`
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — add `id="settings"` anchor

## Acceptance criteria
- [x] Clicking "Restart" shows inline Confirm/Cancel — does not immediately call the API
- [x] Confirming calls the restart API and clears confirm state
- [x] Canceling clears confirm state with no API call
- [x] Clicking the scale advice chip scrolls to the Settings panel
- [x] Typecheck passes

## Out of scope
- Modal-based confirmation (inline is sufficient and less disruptive)
- Keyboard shortcut for confirming
- Multiple simultaneous restarts (confirm one at a time is fine)

## Completed

**Date:** 2026-07-01

### Summary
Added `confirmRestart: string | null` state to `ContainerTable` — clicking restart now sets this state instead of calling the API immediately. `DesktopContainerRow` gained `isConfirming` and `onCancelRestart` props; when confirming it renders "Confirm" and "Cancel" text buttons instead of the refresh icon. Added `id="settings"` to the Settings panel's outer div and wrapped the scale advice chip in `<a href="#settings">` so clicking it scrolls to settings.

### Files changed
- `apps/dashboard/src/components/detail/container-table.tsx` — added confirmRestart state, updated onRestart/isConfirming/onCancelRestart props on DesktopContainerRow
- `apps/dashboard/src/components/detail/container-row.tsx` — added isConfirming/onCancelRestart props, conditional confirm/cancel UI in action cell
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — added `id="settings"` to outermost div
- `apps/dashboard/src/components/detail/health-card.tsx` — wrapped scale advice div in `<a href="#settings">`

### Verification
- typecheck: clean (all 5 packages pass)

### Follow-ups
- `[defer]` MobileContainerRow has its own inline restart with no confirmation — could get the same treatment in a future sprint
