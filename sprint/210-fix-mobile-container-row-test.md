# Sprint 210 — Fix MobileContainerRow restart test failure

> _Promoted from backlog: sprint-190 follow-up, 2026-07-10._

## Goal
Fix the pre-existing test failure in `MobileContainerRow > calls restartContainer and onRefetch on restart button click`.

## Context
This test failure has been tracked since sprint 190 and reconfirmed in sprint 194. The test lives in `apps/dashboard/src/components/detail/container-row.test.tsx`. It predates recent sprint work — the component likely changed (possibly during sprint 167's restart confirmation UX work) without the test being updated.

## Tasks
1. Read `apps/dashboard/src/components/detail/container-row.test.tsx` to understand the failing test.
2. Read the `MobileContainerRow` component to understand the current restart flow (it may now use a confirmation dialog before calling `restartContainer`).
3. Update the test to match the current component behavior — if a confirmation step was added, the test needs to simulate confirming before asserting the restart call.
4. Run the test file to confirm it passes.
5. Run the full dashboard test suite to confirm no regressions.

## Acceptance criteria
- [x] `MobileContainerRow > calls restartContainer and onRefetch on restart button click` passes.
- [x] No other test regressions in the dashboard suite.

## Completed

**Date:** 2026-07-10

### Summary
The `MobileContainerRow` component had a two-step restart confirmation flow added (likely during sprint 167) — the first click sets `confirmRestart = true` to show "Confirm"/"Cancel" buttons, and only the "Confirm" click actually invokes `restartContainer`. The test only simulated the first click, so `restartContainer` was never called.

Updated the test to click "Confirm" after the initial restart button click, matching the component's current interaction model.

### Files changed
- `apps/dashboard/src/components/detail/container-row.test.tsx` — added `user.click(confirmButton)` step after the initial restart button click

### Verification
- `vitest run container-row.test.tsx`: 20/20 pass
- `vitest run` (full dashboard suite): 127/127 pass

### Follow-ups
- none
