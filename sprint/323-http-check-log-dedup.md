# Stop alternating error types from defeating the HTTP-check log dedup
**Difficulty:** 3

## Goal
A permanently unreachable domain logs a health-check failure once, not on every
poll — so the API's log shows real outages instead of a steady drip from the
`test-smoke` fixture.

## Reason
`checkHttp()` in `apps/api/src/routes/project-status.ts` already tries to solve
this: it keeps `lastHttpFailure` per domain and only logs when the failure
signature *changes* (the comment at line ~29 names the `test-smoke` fixture's
RFC 5737 address as exactly the case it is defending against). The defense does
not work. The signature is `String(lastErr)`, and an unreachable host alternates
between two different errors depending on whether the socket refuses fast or the
10 s budget expires first — measured in the live log: 22 `TimeoutError` lines and
19 `TypeError` lines for `192.0.2.1`, i.e. essentially every poll logged, because
each one differed from the one before.

This is small in isolation (41 lines) but it is the exact category of noise that
made the 2026-09-07 outage harder to read: the signal you want is a *change* in
fleet health, and a check that cries wolf every 60 s trains you to skim past
health-check lines. Fixing the dedup properly also removes the reason anyone
would be tempted to silence health-check logging wholesale.

## Context
- `apps/api/src/routes/project-status.ts` (214 lines) — `checkHttp()` at ~line 46.
  `HTTP_CHECK_TIMEOUT_MS = 10_000`, `HTTP_CHECK_ATTEMPTS = 2`. The retry exists
  because a single slow probe used to render healthy projects as Down (sprint's
  comment, 2026-08-27) — **do not weaken the retry or the timeout**; this sprint
  only touches logging.
- `checkHttp` is currently a module-private function with module-level mutable
  state (`lastHttpFailure`). Per the repo's file-size and extraction conventions
  in `~/.claude/CLAUDE.md` (pure logic → helper modules, independently testable),
  extract the failure-reporting decision into a small helper — e.g.
  `apps/api/src/lib/http-check-log.ts` exporting something like
  `shouldLogFailure(domain, err, now)` plus a reset on recovery — so it can be
  unit-tested without a network. Keep `project-status.ts` under 300 lines.
- The fixture: `~/projects/test-smoke/.emit-infra.json` is
  `{"name":"test-smoke","domain":"192.0.2.1",...}` — an RFC 5737 TEST-NET-1
  address that is unroutable *by design*. Note `scripts/collect-metrics.sh`
  already skips this project (`- test-smoke: skipped (missing host or sshKeyName)`),
  so there is precedent for treating it as a non-real target.
- Existing test file: `apps/api/src/routes/project-status.test.ts`. Vitest 3,
  run via `pnpm test` (or `nx test api`).
- This project has no `check:affected` script; its suite is `pnpm test:hooks`,
  `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Tasks
1. Normalize the failure signature so transport-level flapping collapses to one
   class: key on the error's *kind* (e.g. `TimeoutError` vs `TypeError` vs HTTP
   status class) rather than the full `String(err)`, and treat "unreachable" as a
   single state regardless of which of the two errors won the race.
2. Keep a periodic heartbeat so a long outage is not invisible: after the first
   failure log, re-log the same domain at most once per configurable interval
   (default 1 hour) with a count of suppressed occurrences, e.g.
   `HTTP check still failing for X (47 occurrences in the last hour)`.
3. Preserve the recovery line — `HTTP check recovered for <domain>: <status>` must
   still fire on the first success after any failure, and must reset all counters.
4. Skip probing domains that cannot be real: if the configured `domain` is an IP in
   a reserved/documentation range (RFC 5737 `192.0.2.0/24`, `198.51.100.0/24`,
   `203.0.113.0/24`), do not issue the request at all. Return the same "unknown"
   value the dashboard already renders and log once at startup that the project is
   a fixture. Prefer this to hardcoding the name `test-smoke`.
5. Extract the decision logic into `apps/api/src/lib/http-check-log.ts` with an
   injectable clock so the interval behavior is testable without waiting.
6. Add unit tests: alternating `TimeoutError`/`TypeError` for the same domain logs
   once, not twice; suppressed occurrences are counted and surface in the heartbeat
   line; recovery logs once and resets; a reserved-range domain is never fetched;
   two different domains failing do not suppress each other.
7. Confirm `project-status.ts` stays under 300 lines after the change.

## Files involved
- `apps/api/src/routes/project-status.ts` — `checkHttp` delegates its logging decision; adds the reserved-range short-circuit
- new file: `apps/api/src/lib/http-check-log.ts` — dedup/heartbeat decision with an injectable clock
- new file: `apps/api/src/lib/http-check-log.test.ts` — unit coverage for the cases in task 6
- `apps/api/src/routes/project-status.test.ts` — assert the reserved-range domain is not fetched

## Acceptance criteria
- [ ] A domain that alternates between `TimeoutError` and `TypeError` logs one failure line, not one per poll
- [ ] A still-failing domain re-logs at most once per interval with a suppressed-occurrence count
- [ ] `HTTP check recovered for <domain>` still fires on the first success and resets state
- [ ] A domain in an RFC 5737 reserved range is never fetched, and the dashboard's rendering of that project is unchanged
- [ ] Retry count and timeout are unchanged (`HTTP_CHECK_ATTEMPTS = 2`, `HTTP_CHECK_TIMEOUT_MS = 10_000`)
- [ ] `apps/api/src/lib/http-check-log.test.ts` covers every case in task 6
- [ ] `apps/api/src/routes/project-status.ts` is under 300 lines
- [ ] `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass

## Out of scope
- Deleting or reconfiguring the `test-smoke` fixture project itself — it earns its keep as a discovery-path test case
- Changing the health-check interval, retry count, or timeout
- The `[lastDeployEpoch] failed to read/parse .../test-smoke/.deploy-history.jsonl` warning — same fixture, different code path; fold in only if trivial
- Structured/JSON logging for the API generally
