# Sprint 180 — Backup completion UX polish

> _Promoted from sprint-178 follow-ups, 2026-07-02._

## Goal
Improve the backup trigger UX with an elapsed-time counter during polling and a timeout message when the 10-minute limit is reached.

## Context
`apps/dashboard/src/components/detail/backup-panel.tsx` has completion polling that was added in sprint 178. Two gaps remain:

1. **No elapsed indicator**: While polling, the button shows "Running..." with no sense of how long it's been. Adding a simple elapsed counter ("Running... 45s") gives users confidence the system is working.
2. **Silent timeout**: The 10-minute polling timeout stops silently — the button reverts to its default state with no message. Should show "Backup status unknown — check logs" or similar on timeout.

## Tasks
1. Read `apps/dashboard/src/components/detail/backup-panel.tsx` to locate the polling logic.
2. Add an elapsed-time counter: track the start time when polling begins, update a display string every second ("Running... 12s", "Running... 1m 30s").
3. Add a timeout message: when the 10-minute limit hits, set a state like `pollResult: 'timeout'` and display "Backup status unknown — check server logs" in the button area.
4. Typecheck.

## Acceptance criteria
- [x] While polling, button shows elapsed time (e.g. "Running... 45s")
- [x] After 10-minute timeout, a message indicates the backup status is unknown
- [x] Typecheck passes

## Completed

**Date:** 2026-07-02

### Summary
Added elapsed-time display and timeout feedback to the backup trigger button. A new `elapsedSecs` state increments every second via `useEffect` while `runningBackup` is true, resetting to 0 when polling stops. The button now shows "Running… 12s" / "Running… 1m 30s" during polling. The 10-minute timeout now also sets `backupResult: 'timeout'`, which renders "Status unknown — check logs" in the button — consistent with the existing 'complete' and 'failed' states.

### Files changed
- `apps/dashboard/src/components/detail/backup-panel.tsx` — added `elapsedSecs` state, elapsed counter useEffect, `fmtElapsed` helper, timeout backupResult, updated button display

### Verification
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
none
