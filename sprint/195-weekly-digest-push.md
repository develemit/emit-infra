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
- [ ] `GET /fleet/digest` returns correct aggregates for a seeded week of data (tested)
- [ ] Summary line formats correctly for 0/1/many incidents and missing disk data
- [ ] Digest fires at most once per 7 days, surviving API restarts
- [ ] Typecheck clean; API tests pass

## Out of scope
- Email delivery, HTML reports
- Per-user digest preferences (all subscribers get it)
