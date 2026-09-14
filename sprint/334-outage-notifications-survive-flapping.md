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
- [ ] Replaying the exact diner-decider incident sequence above through the new
      state machine yields **one** down notification, not four
- [ ] A site that stays down produces reminders at 1 hour and then every 6 hours,
      each stating the duration
- [ ] The down notification includes the HTTP status and cause — a 526 mentions
      an invalid or expired origin certificate
- [ ] After a simulated restart during an outage, the monitor still sends
      reminders and a recovery notification
- [ ] The cause of the mid-outage `up` events is recorded in the Completed section
- [ ] Coverage in `http-health.test.ts` for the incident replay, reminders,
      status-to-cause mapping and restart seeding
- [ ] `status-monitor.ts` stays under 300 lines
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass (this repo has no `check:affected`)

## Out of scope
- Certificate expiry and renewal alerts — sprints 332 and 333.
- External uptime monitoring that works while this Mac is asleep (a separate
  backlog item).
- Changing poll frequency or the dashboard incident timeline UI.
