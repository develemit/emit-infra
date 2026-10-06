# Make outage notifications calm, specific, and repeated while a site stays down
**Difficulty:** 3

## Goal
When a fleet site goes down you get one clear notification that says why,
followed by reminders while it stays down — instead of a burst of up/down noise
followed by silence.

## Reason
The monitor actually detected the 2026-09-13 diner-decider outage. Its
`.incidents.jsonl` shows:

```
2026-09-13 16:11Z http down
2026-09-13 16:12Z http up
2026-09-13 16:13Z http down
2026-09-13 16:15Z http up
2026-09-13 16:23Z http down
2026-09-13 16:24Z http up
2026-09-13 16:26Z http down
2026-09-14 18:24Z http up
```

That is seven push notifications in 15 minutes, then **26 hours of silence**
while the site stayed down. The one message sent — "Health check failing — app
may be down." — never said the cause was an expired TLS certificate (HTTP 526).
A burst of flapping trains you to ignore it, and a single notification is easy
to miss. Certificate alerts (sprints 332–333) cover this particular cause, but
the next outage will have a different one.

## Context

### Current behaviour — `apps/api/src/lib/status-monitor.ts`
- `httpProbe(url)` returns `'up'` only when `res.ok`. After 3 failures it opens
  a circuit for 5 polls and returns `'down'` without fetching.
- `poll()` notifies only on a **transition** (`httpPrev === 'up' && httpNext === 'down'`,
  and the reverse). There's no reminder while a site stays down.
- `httpState` is an in-memory `Map`. If the API restarts during an outage,
  `httpPrev` is `undefined`, so neither transition matches — **the ongoing outage
  is never notified**. The emit-infra API restarts often (launchd, supervisor,
  sprints 310–325).
- The same transition-only pattern applies to the SSH `sshState` probe.

### Open question to answer first
The incidents show `up` events while the site was returning 526. `httpProbe`
only returns `'up'` on a 2xx, so something did produce 2xx responses mid-outage
— Cloudflare serving a cached or edge response, redirects, or the health URL
behaving differently from the homepage. Find out before designing the debounce:
the fix is different if the flaps were real responses rather than probe noise.
diner-decider's `healthCheck.url` is `https://dinerdecider.com/api/health`.
Record what you find.

### Cloudflare status meanings worth naming in notifications
526 → origin TLS certificate invalid or expired; 525 → TLS handshake with origin
failed; 522 → origin connection timed out; 521 → origin refused the connection;
502/504 → bad gateway or timeout.

### Conventions
`status-monitor.ts` is 246 lines — extract HTTP health state into a new
`lib/http-health.ts` rather than growing it. Vitest beside source. No
`check:affected` in this repo; the suite is `pnpm test`, `pnpm typecheck`,
`pnpm lint`. Push via `sendToAll()` in `lib/push.ts`; incidents are appended to
each project's `.incidents.jsonl`.

## Tasks
1. Investigate and record why `up` events appeared during the 526 outage.
2. Extract HTTP health state handling into `lib/http-health.ts` as testable,
   mostly pure logic (a small state machine fed by probe results and time).
3. Debounce: require several consecutive failed polls (default 3) before
   declaring down, and several successes before declaring recovered.
4. Include the HTTP status and a plain-language cause in the down notification,
   using the table above; include how long it's been down in reminders.
5. Re-notify while a site stays down: after 1 hour, then every 6 hours.
6. Survive restarts: on startup, seed each project's state from the last
   `.incidents.jsonl` event, so an outage already in progress still gets
   reminders and a recovery notification.
7. Apply the same restart seeding and reminders to the SSH probe if the change
   is small; otherwise note it as a follow-up.

## Files involved
- new file: `apps/api/src/lib/http-health.ts` — debounce, reminders, cause text, state seeding
- new file: `apps/api/src/lib/http-health.test.ts`
- `apps/api/src/lib/status-monitor.ts` — delegate HTTP state handling

## Acceptance criteria
- [x] Replaying the exact diner-decider incident sequence above through the new
      state machine yields **one** down notification, not four
- [x] A site that stays down produces reminders at 1 hour and then every 6 hours,
      each stating the duration
- [x] The down notification includes the HTTP status and cause — a 526 mentions
      an invalid or expired origin certificate
- [x] After a simulated restart during an outage, the monitor still sends
      reminders and a recovery notification
- [x] The cause of the mid-outage `up` events is recorded in the Completed section
- [x] Coverage in `http-health.test.ts` for the incident replay, reminders,
      status-to-cause mapping and restart seeding
- [x] `status-monitor.ts` stays under 300 lines
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass (this repo has no `check:affected`)

## Out of scope
- Certificate expiry and renewal alerts — sprints 332 and 333.
- External uptime monitoring that works while this Mac is asleep (a separate
  backlog item).
- Changing poll frequency or the dashboard incident timeline UI.

## Completed

**Date:** 2026-09-14

### Summary
Investigated the mid-outage `up` events first, since the debounce design depended
on the answer. diner-decider's expired cert (`fullchain1.pem`, `notAfter=Sep 13
15:49:54 2026 GMT`, confirmed from the letsencrypt archive) matches the incident
window exactly — every logged transition on 2026-09-13 happened after that
timestamp. SSH'd into the server and pulled nginx's access log for that exact
window: **100% of requests to `/api/health` succeeded with 200** — the origin app
was never actually unhealthy. That means the `down` events the monitor saw (526)
never reached nginx at all; they were rejected at Cloudflare's edge, which
returns 526 without proxying through when it can't validate the origin's TLS
cert. The most plausible explanation for the flapping, given a cert that had
unambiguously already expired and an origin serving 100% 2xx the whole time:
Cloudflare pools persistent connections to the origin and doesn't necessarily
re-validate the origin cert on every request over an already-open connection —
only when establishing a new one. Connections opened before 15:49:54Z kept
succeeding until they cycled out; new connections failed immediately. Recorded
here per the sprint's "open question."

Built `lib/http-health.ts` as a pure, protocol-agnostic debounced state machine
(`stepHealth`) shared by both the HTTP and SSH probes — SSH just calls it with
`{ ok: boolean }` and no status code, satisfying task 7's stretch goal at
near-zero extra cost. It requires 3 consecutive failures before declaring
`down` and 3 consecutive successes before declaring recovered, which is what
makes the diner-decider replay collapse from 4 notifications to 1: none of the
brief flaps reached 3 in a row, only the final sustained outage did. While
down, it emits a `reminder` event at 1 hour and then every 6 hours
(`FIRST_REMINDER_MS` / `REMINDER_INTERVAL_MS`), each carrying the down
duration. `seedHealthState()` reconstructs state from the last `.incidents.jsonl`
event so a monitor restart mid-outage resumes as `down` with `downSinceMs` from
the recorded event — the restart no longer erases the outage.

Split notification/formatting and file I/O out of `status-monitor.ts` into two
new small modules to keep it under 300 lines: `lib/incidents.ts` (the
`.incidents.jsonl` read/write, generic enough to seed both probes) and
`lib/health-notify.ts` (turns `HealthEvent`s into push payloads — down/reminder
share a push tag so a reminder replaces the stale "down" notification on the
device instead of stacking). `status-monitor.ts` itself now just wires
`probeProject`/`httpProbe` results through `stepHealth` and hands the resulting
events to `handleHealthEvents`.

### Files changed
- (new) `apps/api/src/lib/http-health.ts` — debounced up/down state machine, cause text, duration formatting, restart seeding
- (new) `apps/api/src/lib/http-health.test.ts` — incident replay, reminder timing, cause mapping, restart seeding
- (new) `apps/api/src/lib/incidents.ts` — `.incidents.jsonl` read/write, extracted from status-monitor.ts
- (new) `apps/api/src/lib/health-notify.ts` — push payload formatting for health events, state map seeding
- `apps/api/src/lib/status-monitor.ts` — delegates ssh/http state handling to `http-health.ts` + `health-notify.ts`; `httpProbe` now returns a status code

### Verification
- `pnpm test`: 439/439 pass (13 new in `http-health.test.ts`)
- `pnpm typecheck`: clean
- `pnpm lint`: clean
- `status-monitor.ts`: 248 lines (was 281, stayed under 300 despite the new debounce/seeding wiring)
- Live: SSH'd into diner-decider and pulled its nginx access log + certbot journal
  + letsencrypt archive to confirm the mid-outage `up` events' cause (see Summary)

### Follow-ups
- `[defer]` The reminder/seeding logic is currently exercised only via unit
  tests on the pure state machine, not an integration test that drives
  `status-monitor.ts`'s `poll()` end-to-end with a fake clock — would catch
  wiring regressions the unit tests can't see.
- `[defer]` `.incidents.jsonl` still grows unboundedly (same as before this
  sprint) — no rotation/pruning, unlike `.alerts.jsonl` which has
  `pruneAlertJsonl`.
- `[defer]` diner-decider's certbot renewal is still failing via standalone
  mode against port 80 as of 2026-09-14 17:36Z (confirmed live in this
  sprint's investigation) — the webroot fix mentioned in project memory was
  applied manually on the server, not in Ansible, so it isn't guaranteed to
  survive reprovisioning. Sprint 335 covers Ansible rejecting standalone
  renewal config.

