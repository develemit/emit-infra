# Sprint 209 — Alert JSONL file pruning (90-day retention)

> _Promoted from backlog: sprint-191 follow-up, 2026-07-10._

## Goal
Add automatic 90-day retention pruning for `.alerts.jsonl` and `.alert-state.json` files so they don't grow unbounded.

## Context
The alert rules engine (sprint 191) writes per-project `.alerts.jsonl` event logs and `.alert-state.json` state files, but never prunes them. On a long-running instance, these files will grow indefinitely. A 90-day retention window is sufficient for historical review while keeping file sizes manageable.

Relevant files:
- `apps/api/src/routes/` — alert-related route files that write `.alerts.jsonl`
- The alert engine logic that writes `.alert-state.json`
- Look for where `alerts.jsonl` is appended to find the write path

## Tasks
1. Find where `.alerts.jsonl` is written (grep for `alerts.jsonl` in the API).
2. Add a pruning function that:
   - Reads the JSONL file
   - Filters to entries with timestamps within the last 90 days
   - Rewrites the file with only retained entries
3. Call the prune function after each append, or on a periodic basis (e.g., once per status polling cycle). Prefer the simpler approach — prune after append if the file exceeds a size threshold (e.g., >100KB) to avoid reading on every write.
4. For `.alert-state.json`: this likely stays small (one entry per project/metric), so only prune if entries reference metrics that no longer exist in the project config.
5. Add a test for the pruning logic.

## Acceptance criteria
- [x] `.alerts.jsonl` entries older than 90 days are automatically removed.
- [x] Pruning doesn't run on every write — only when the file exceeds a reasonable size threshold.
- [x] Existing alert history reads still work correctly after pruning.
- [x] Test covers the pruning boundary (entries at 89 days kept, 91 days removed).

## Completed

**Date:** 2026-07-10

### Summary
Added 90-day retention pruning for `.alerts.jsonl` files. The logic lives in a new `lib/prune-alerts.ts` module that exports a pure `filterAlertEntries()` function (easily unit-testable) and an async `pruneAlertJsonl()` that does the I/O. Pruning is gated behind a 100 KB size check so it only reads + rewrites the file when it has actually grown large. `persistAlerts()` in `status-monitor.ts` calls it after each batch of fired alerts.

For `.alert-state.json`, no explicit pruning was needed: `evaluateRules()` already produces a `newState` that only contains currently-breached entries — keys for removed/recovered rules are naturally dropped each poll cycle.

### Files changed
- (new) `apps/api/src/lib/prune-alerts.ts` — `filterAlertEntries` and `pruneAlertJsonl`
- (new) `apps/api/src/lib/prune-alerts.test.ts` — 8 unit tests covering retention boundary
- `apps/api/src/lib/status-monitor.ts` — import `pruneAlertJsonl`, call it in `persistAlerts` after append

### Verification
- `pnpm nx test api`: 230/230 pass (8 new)
- `pnpm nx lint api`: clean

### Follow-ups
none
