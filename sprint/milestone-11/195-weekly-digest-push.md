# Weekly digest push: incidents, deploys, and disk trend summary
**Difficulty:** 3

## Goal
Once a week, subscribers receive a push notification summarizing the fleet's week — incident count, deploy count, and notable disk growth — and the digest content is also available via an API route for inspection.

## Reason
A solo operator checks the dashboard ad-hoc; trends (disk creeping up, deploy velocity, incident frequency) are easy to miss without a periodic nudge. Flagged in the 2026-07-02 scan. All the raw data and the push plumbing already exist — this is an aggregation + scheduling layer.

## Context
- Data sources (all local JSONL reads, no SSH): incidents + deploys via the history route helpers (`apps/api/src/routes/history.ts`, pairing helper from sprint 165; fleet aggregation route from sprint 190 if it landed — reuse it), disk metrics via the metrics history the charts read.
- Push: `apps/api/src/lib/push.ts` (`sendToAll` or equivalent — read it). Push payloads are short; the digest notification body should be one line like `"This week: 2 incidents, 14 deploys, disk +9% on emit-vision"`, with the URL pointing at `/health` (or `/health/incidents` if sprint 190 landed).
- Digest computation: new pure module `apps/api/src/lib/weekly-digest.ts` — `buildDigest(projects, since) → { incidentCount, deployCount, diskDeltas[], summaryLine }`. Unit-test the aggregation and the summary-line formatting (singular/plural, no-data week).
- Route: `GET /fleet/digest?days=7` returning the digest JSON (handy for manual checks and for the scheduler to hit).
- Scheduling: the API already runs a long-lived process with interval-based polling (status monitor). Simplest reliable approach: a `setInterval` check in the API that fires when a persisted `lastDigestSentAt` (small JSON state file, data-dir convention) is >7 days old — survives restarts, no external cron dependency. Check hourly; send + update state when due. Read how the status monitor structures its interval/lifecycle and mirror it.
- Timezone/timing precision doesn't matter (weekly cadence); do NOT add a cron library.

## Tasks
1. Read push.ts, history helpers, sprint 190's fleet route (if present), and the status monitor's interval lifecycle.
2. Implement `weekly-digest.ts` (pure aggregation + formatting) with unit tests.
3. Add `GET /fleet/digest` route + test.
4. Add the hourly due-check + `lastDigestSentAt` persistence + push send to the API lifecycle.
5. Typecheck; run API tests.

## Files involved
- new file: `apps/api/src/lib/weekly-digest.ts` + `weekly-digest.test.ts`
- new or existing route file for `GET /fleet/digest` (+ registration, + test)
- API entry/monitor file — hourly due-check wiring
- new state file convention for `lastDigestSentAt` (follow data-dir helpers)

## Acceptance criteria
- [x] `GET /fleet/digest` returns correct aggregates for a seeded week of data (tested)
- [x] Summary line formats correctly for 0/1/many incidents and missing disk data
- [x] Digest fires at most once per 7 days, surviving API restarts
- [x] Typecheck clean; API tests pass

## Completed

**Date:** 2026-07-03

### Summary
Implemented the full weekly digest pipeline: a pure `buildDigest()` aggregation module, a `GET /fleet/digest` route, and a `startDigestScheduler()` lifecycle function wired into the API entry point. The digest aggregates incident counts (excluding false positives), deploy counts, and disk delta from `.jsonl` history files across all registered projects. The summary line handles singular/plural forms and omits disk info when unavailable or unchanged.

The scheduler persists `lastSentAt` to `~/.emit-infra/digest-state.json` (mode 600), checks hourly with a 15-second startup delay (mirroring the status monitor pattern), and fires `sendToAll` when 7+ days have elapsed. State file survives API restarts; the next check on startup will either skip (not due) or send immediately (overdue).

`exactOptionalPropertyTypes` required changing the interface fields from optional `?:` to explicit `number | undefined`, which also required updating the test helper spread pattern (`const nd = { diskPctNow: undefined, diskPctWeekAgo: undefined }`).

### Files changed
- (new) `apps/api/src/lib/weekly-digest.ts` — pure aggregation + formatting (`buildDigest`)
- (new) `apps/api/src/lib/weekly-digest.test.ts` — 13 unit tests for counts, summary line, disk delta sorting/formatting
- (new) `apps/api/src/lib/digest-scheduler.ts` — hourly due-check, state file persistence, `startDigestScheduler()`
- `apps/api/src/routes/fleet.ts` — added `GET /fleet/digest` route + `MetricPoint` interface
- `apps/api/src/routes/fleet.test.ts` — 3 new tests for the digest route (400 validation, response shape, `buildDigest` call args)
- `apps/api/src/index.ts` — wired `startDigestScheduler()` after `startStatusMonitor()`

### Verification
- typecheck: clean
- api:test: 189/189 pass

### Follow-ups
- `[defer]` `pairIncidents` is duplicated between `fleet.ts` and `digest-scheduler.ts` — extract to a shared lib helper if a third callsite appears

## Out of scope
- Email delivery, HTML reports
- Per-user digest preferences (all subscribers get it)
