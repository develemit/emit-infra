# Fix unbounded session Map, stale push store cache, and silent localStorage quota failures
**Difficulty:** 3

## Goal
The long-running API process no longer leaks memory through the claude-session Map, the push subscription store cache invalidates on mutation, and the dashboard warns (instead of silently stopping) when localStorage metric persistence hits quota.

## Reason
The API is a long-lived process; the opportunity scan (2026-07-02) found two server-side caches with correctness/memory problems and one silent client-side failure. The push store bug is a real behavioral bug (double-sends to pruned endpoints or missed new subscriptions within a process lifetime), not just hygiene.

## Context
- `apps/api/src/lib/claude-session.ts` — holds a session-ID Map with no eviction, TTL, or size cap. Grows forever. Read the file to see how sessions are keyed and used before choosing eviction (a simple TTL sweep or LRU cap of e.g. 100 entries is fine — pick the least invasive that matches usage).
- `apps/api/src/lib/push.ts` lines ~64-68 — `let cached: PushStore` is populated once and never cleared when `addSubscription` / `removeSubscription` mutate the underlying store. Mutations must invalidate (or update) the cache.
- `apps/dashboard/src/lib/metric-history.ts` lines ~57-59 — a catch around localStorage writes swallows quota errors silently; after quota fills, metrics stop persisting with zero signal. Minimal fix: on quota error, prune the oldest stored entries and retry once; if it still fails, `console.warn` once (don't spam every write).
- Project convention: no comments unless the *why* is non-obvious; files ≤300 lines.

## Tasks
1. Read `apps/api/src/lib/claude-session.ts`. Add eviction: either TTL-expire entries on access/insert or cap the Map size (evict oldest). Keep it simple — no new dependencies.
2. Read `apps/api/src/lib/push.ts`. Make `addSubscription` / `removeSubscription` invalidate or synchronously update `cached` so subsequent reads see fresh state.
3. Read `apps/dashboard/src/lib/metric-history.ts`. On quota error: prune oldest entries, retry once, warn once if still failing (use a module-level flag to avoid repeated warns).
4. If `push.ts` has existing tests, extend them to cover cache invalidation after add/remove. If not, add a small test following the API test patterns in `apps/api/src/routes/*.test.ts`.
5. Typecheck both apps; run API tests.

## Files involved
- `apps/api/src/lib/claude-session.ts` — add eviction/TTL
- `apps/api/src/lib/push.ts` — cache invalidation on mutation
- `apps/dashboard/src/lib/metric-history.ts` — quota handling with prune + single warn
- possibly `apps/api/src/lib/push.test.ts` (new or extended)

## Acceptance criteria
- [x] claude-session Map is bounded (TTL or max-size eviction)
- [x] Adding/removing a push subscription is reflected in the next read within the same process
- [x] localStorage quota exhaustion prunes old entries and warns once instead of failing silently
- [x] Typecheck clean; API tests pass

## Out of scope
- TTL-cache distinction between "confirmed down" and "probe failed" nulls (backlog)
- readJsonl streaming (sprint 184)

## Completed

**Date:** 2026-07-02

### Summary
`claude-session.ts` now stores entries as `{ agentSessionId, expiresAt }` with a 24h TTL and a 100-entry cap: expired entries are swept on insert and lazily deleted on read, and when the cap is exceeded the oldest insertion is evicted. No new dependencies.

In `push.ts`, mutations already operated on the cached store object (so the reported staleness couldn't bite in the current code paths), but the invariant was implicit and fragile — it held only because `getStore()` returned the same reference. Made it explicit: `save()` now assigns the persisted store to `cached`, so any code path that saves a store instance keeps the cache in sync by construction. Added `push.test.ts` (5 tests) covering add→read, remove→read, unknown-endpoint removal, dedup on re-add, and cache↔disk consistency, using `vi.hoisted` fs state + `vi.resetModules` per test to reset the module-level cache.

`metric-history.ts` write path extracted to a `persist()` helper: on quota error it retries once with the newest `MAX_POINTS/2` entries; if that also fails it `console.warn`s once (module-level flag) instead of failing silently forever.

### Files changed
- `apps/api/src/lib/claude-session.ts` — TTL (24h) + max-size (100) eviction for the session map
- `apps/api/src/lib/push.ts` — `save()` keeps the in-memory cache in sync with persisted state
- (new) `apps/api/src/lib/push.test.ts` — 5 tests for subscription store cache behavior
- `apps/dashboard/src/lib/metric-history.ts` — quota-aware `persist()` with prune-and-retry + single warn

### Verification
- `npx nx run api:test`: 115/115 pass (14 files, +5 new)
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` claude-session TTL/cap constants (24h/100) are hardcoded — could move to env config if ops chat usage ever grows beyond a solo operator
- `[defer]` metric-history quota prune only trims the current project's key; a full-storage sweep across all `emit-infra:metrics:*` keys would recover more space
