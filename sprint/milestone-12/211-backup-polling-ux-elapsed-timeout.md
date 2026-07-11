# Sprint 211 — Backup polling UX: elapsed timer and timeout feedback

> _Promoted from backlog: sprint-178 follow-ups, 2026-07-10._

## Goal
Show an elapsed-time indicator during backup polling, and display an explicit "status unknown" message when the 10-minute polling timeout is reached.

## Context
Sprint 178 added backup completion polling with configurable thresholds, but the UI only shows "Running..." during the polling phase. Two UX gaps:
1. No elapsed-time counter — the user has no sense of how long the backup has been running.
2. The 10-minute timeout silently stops polling with no user feedback — it just stays on the last known state.

## Tasks
1. Find the backup polling hook/component (likely in `apps/dashboard/` — grep for backup polling or the 10-minute timeout).
2. Add an elapsed-time display: start a counter when backup polling begins, show "Running... (Xm Ys)" that updates every second.
3. On timeout: instead of silently stopping, update the status to show "Backup status unknown — check server logs" with a warning style.
4. Ensure the elapsed timer is cleaned up on component unmount and when polling completes normally.

## Acceptance criteria
- During backup polling, an elapsed-time counter is visible (e.g., "Running... (2m 15s)").
- When the 10-minute timeout fires, a clear warning message is shown instead of silent stop.
- Normal backup completion still works as before (timer stops, success state shown).

## Completed

**Date:** 2026-07-10

### Summary
The sprint's two UX gaps were already resolved: sprint 180 (2026-07-02) added the elapsed-time counter (`Running… {fmtElapsed(elapsedSecs)}`) and the timeout state (`Status unknown — check logs`) as a follow-up to sprint 178. Sprint 194 then extracted `fmtElapsed` to `backup-panel-helpers.ts` and added comprehensive state-machine tests covering both the elapsed display and the timeout transition.

This sprint file was promoted from backlog on 2026-07-10, but the implementation was already committed and passing. No new code was needed.

### Files changed
- `apps/dashboard/src/components/detail/backup-panel.tsx` — elapsed timer + timeout state already in place (sprint 180)
- `apps/dashboard/src/components/detail/backup-panel-helpers.ts` — `fmtElapsed` helper already extracted (sprint 194)
- `apps/dashboard/src/components/detail/backup-panel.test.tsx` — state machine tests already cover all criteria (sprint 194)

### Verification
- `pnpm --filter dashboard test --run`: 127/127 pass
  - `BackupPanel button state machine > shows fmtElapsed in running button — 45s` ✓
  - `BackupPanel button state machine > shows fmtElapsed in running button — 1m 30s` ✓
  - `BackupPanel button state machine > transitions to timeout after 600s with no completion` ✓
  - `BackupPanel button state machine > transitions to complete when getBackupStatus returns new lastRun` ✓

### Follow-ups
none
