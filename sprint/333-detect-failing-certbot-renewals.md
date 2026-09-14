# Warn the day certbot renewal starts failing, not three weeks later
**Difficulty:** 3

## Goal
When a server's automatic certificate renewal fails while a certificate is due
for renewal, emit-infra says so — with certbot's own error — on the day it
happens, instead of waiting for the expiry countdown.

## Reason
diner-decider's certbot timer ran twice a day and failed every time for about
30 days before the certificate expired on 2026-09-13, each run logging:

> Could not bind TCP port 80 because it is already in use by another process

Sprint 332's expiry alert first fires at 21 days remaining — about nine days
after renewal started failing. The failure itself was visible from the very
first run through `systemctl show certbot.service -p Result`, and the journal
held the exact cause. Catching it on day one turns a near-miss into a routine
fix with a month of slack, and the error text tells you what to fix.

## Context

### Builds on sprint 332
Sprint 332 creates `apps/api/src/lib/cert-probe.ts`, which reads every
certificate on a server inside the monitor's single SSH call. Read its
`## Completed` section first. Extend that same SSH command — do not add a second
round trip per poll.

### What systemd exposes
- `systemctl show certbot.service -p Result --value` → `success` or `exit-code`
- `systemctl show certbot.service -p ExecMainExitTimestamp --value` → when the
  last run ended
- `journalctl -u certbot -n 20 --no-pager` → the failing error lines
- On a server with no timer (certbot run from cron, or not installed), these are
  empty. Treat that as unknown, not as healthy.

### The stale-result trap — verified live
`Result` is the **last run's** outcome and persists until the next run. After
diner-decider's renewal was fixed by hand on 2026-09-14, `Result` still read
`exit-code` until the next 07:22 UTC timer run, even though its certificate was
valid for 89 days. An alert keyed on `Result` alone would fire right after a fix.
So:

- **Alert** only when the last run failed **and** the soonest certificate is
  inside certbot's 30-day renewal window — renewal was actually needed and didn't
  happen.
- A failed last run with every certificate more than 30 days out is stale state:
  surface it, don't notify.
- Clear once a later run succeeds or the certificate moves out of the window.

diner-decider is the live test case for the stale branch: as of 2026-09-14 it
shows `exit-code` with a certificate 89 days out, so it must **not** alert.

### The existing cert-details route
`apps/api/src/routes/cert.ts` (sprint 146) reports `renewTimerLastRan` from the
timer's `LastTriggerUSec` — when the timer fired, not whether renewal succeeded.
That's why the failure was invisible there too. backlog.md also notes that the
`LastTriggerUSec` microsecond parsing is unverified on real servers; check it
while you're here.

### Conventions
Vitest beside source. No `check:affected` in this repo; the suite is `pnpm test`,
`pnpm typecheck`, `pnpm lint`. All server interaction in this sprint is read-only.

## Tasks
1. Extend `cert-probe.ts`'s SSH command to also capture certbot's last `Result`,
   its exit timestamp, and the most recent error line from the journal.
2. Add a pure function that classifies renewal health: `failing` (last run failed
   and soonest cert ≤ 30 days), `stale-failure` (last run failed, all certs
   > 30 days), `ok`, `unknown`.
3. Notify on `failing` with certbot's error line in the body, using the same push
   path and an at-most-daily cooldown. Don't notify on `stale-failure`.
4. Add the last renewal result and error to the `cert-details` response in
   `routes/cert.ts`, and check `renewTimerLastRan` against real servers.
5. Verify read-only against the live fleet and record each server's
   classification. diner-decider must come out `stale-failure` or `ok`, never
   `failing`.

## Files involved
- `apps/api/src/lib/cert-probe.ts` — capture certbot's outcome and error; renewal classification
- `apps/api/src/lib/cert-probe.test.ts` — classification and parsing cases
- `apps/api/src/lib/status-monitor.ts` — notify on `failing`
- `apps/api/src/routes/cert.ts` — expose the last renewal result and error

## Acceptance criteria
- [ ] Last run failed with a certificate at 25 days → `failing`, and the
      notification contains certbot's error line
- [ ] Last run failed with every certificate beyond 30 days → `stale-failure`, no
      notification
- [ ] No certbot timer, or unreadable systemd state → `unknown`, never `ok`
- [ ] Classification is based on the soonest certificate (reusing sprint 332's
      enumeration), and the probe stays one SSH call per poll
- [ ] `cert-details` returns the last renewal result and error
- [ ] Live read-only check records every server's classification; diner-decider
      is not `failing` — quote its output
- [ ] Coverage in `cert-probe.test.ts` for all four classifications, including the
      exact diner-decider stale case and an error line extracted from the journal
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass (this repo has no `check:affected`)

## Out of scope
- Fixing renewals automatically on servers — detection only.
- The expiry-countdown alert itself — sprint 332.
- Outage flapping and reminders — sprint 334.
- Ansible provisioning — sprint 335.
