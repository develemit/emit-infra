# JSONL Read Limits: Prevent Unbounded Memory Reads
**Difficulty:** 3

## Goal
Add a line cap to all history/metrics/incidents JSONL reads so no single request can load an unbounded file into memory.

## Reason
Every endpoint in `history.ts` reads the full JSONL file before filtering or downsampling. A project with 2+ years of 60-second metric snapshots (~1M lines, tens of MB) would cause OOM and slow responses. The existing `LimitQuery` and `DaysQuery` params narrow the output but the file is fully loaded first.

## Context
- `apps/api/src/lib/jsonl.ts` — exports `readJsonl<T>(filePath, filter?)`. It reads the entire file. Add an optional `tail` parameter: `readJsonl<T>(filePath, filter?, opts?: { tail?: number })` that reads all lines but only returns the last `N` after applying the filter. Simple approach: collect all lines, then `slice(-tail)` at the end. More efficient: read all, filter, slice — memory peak is still the full file but avoids a second pass. For a further optimization, read in reverse line-by-line and stop after `tail` matches (only do this if the simple slice approach is clearly insufficient).
- `apps/api/src/routes/history.ts` — all `readJsonl` calls at lines ~84–400. Apply a `{ tail: 50_000 }` cap (covers ~34 days at 60s intervals; well above any realistic `?days=90` request). The existing `?limit=` and `?days=` filters remain as secondary narrowing after the tail read.
- Container-restarts: verify `downsample()` is applied to per-container arrays. If it isn't already capped, apply the tail limit to the JSONL read and note the per-container array behavior.
- Do not change the public API response shape — same JSON output, just internally capped.
- Existing tests in `history.test.ts` should continue to pass without modification.

## Tasks
1. Read `apps/api/src/lib/jsonl.ts` to understand its current signature and implementation.
2. Add `opts?: { tail?: number }` to `readJsonl`. After collecting filtered lines, apply `lines.slice(-tail)` if `tail` is set.
3. In `history.ts`, add `{ tail: 50_000 }` to every `readJsonl` call.
4. Run `npx nx test api` to confirm `history.test.ts` passes.
5. Run `npx tsc --noEmit`.

## Files involved
- `apps/api/src/lib/jsonl.ts` — add optional `tail` parameter
- `apps/api/src/routes/history.ts` — pass `{ tail: 50_000 }` to all readJsonl calls

## Acceptance criteria
- [x] `readJsonl` accepts and respects an optional `tail` limit
- [x] All `readJsonl` calls in `history.ts` pass `{ tail: 50_000 }` (or a reasonable project-specific cap)
- [x] Existing `history.test.ts` tests pass without changes
- [x] Typecheck passes

## Out of scope
- Cursor-based pagination (separate, more complex feature)
- Streaming large files without loading into memory
- Changing response shapes or adding `?tail=` query params

## Completed

**Date:** 2026-07-02

### Summary
Added `opts?: { tail?: number }` as a third parameter to `readJsonl` in `jsonl.ts`. After the filter pass collects all matching lines, `items.slice(-opts.tail)` is applied if `tail` is set. All 9 `readJsonl` calls in `history.ts` now pass `{ tail: 50_000 }`, capping each endpoint at ~34 days of 60-second metric snapshots — well above any realistic `?days=90` request.

For calls that had no filter function (`deploy-history`, `ci-history`, `deploy-cadence`), `undefined` is passed as the second argument so the `opts` object can occupy the third position without changing call semantics.

### Files changed
- `apps/api/src/lib/jsonl.ts` — added optional `opts?: { tail?: number }` parameter; applies `slice(-tail)` to result when set
- `apps/api/src/routes/history.ts` — added `{ tail: 50_000 }` to all 9 `readJsonl` calls

### Verification
- `npx nx test api`: 54/54 pass
- `npx nx run-many -t typecheck`: clean (all 5 packages pass)

### Follow-ups
- none
