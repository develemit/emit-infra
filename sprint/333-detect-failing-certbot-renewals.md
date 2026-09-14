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
- [x] Last run failed with a certificate at 25 days → `failing`, and the
      notification contains certbot's error line
- [x] Last run failed with every certificate beyond 30 days → `stale-failure`, no
      notification
- [x] No certbot timer, or unreadable systemd state → `unknown`, never `ok`
- [x] Classification is based on the soonest certificate (reusing sprint 332's
      enumeration), and the probe stays one SSH call per poll
- [x] `cert-details` returns the last renewal result and error
- [x] Live read-only check records every server's classification; diner-decider
      is not `failing` — quote its output
- [x] Coverage in `cert-probe.test.ts` for all four classifications, including the
      exact diner-decider stale case and an error line extracted from the journal
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass (this repo has no `check:affected`)

## Out of scope
- Fixing renewals automatically on servers — detection only.
- The expiry-countdown alert itself — sprint 332.
- Outage flapping and reminders — sprint 334.
- Ansible provisioning — sprint 335.

## Completed

**Date:** 2026-09-14

### Summary
`cert-probe.ts`'s single SSH probe command now also captures certbot's last
`Result`, `ExecMainExitTimestamp`, and its most recent journal error line —
all inside the same command sprint 332 already makes, using a
`printf 'KEY=%s\n' "$(...)"` pattern so each field is exactly one line
regardless of whether the underlying command produced output (verified live:
`systemctl show <nonexistent>.service -p Result --value` returns `success`,
not empty — the misleading default that makes `Result` alone untrustworthy
for "no timer" detection). A new `classifyRenewalHealth()` combines that
status with the soonest certificate (reusing sprint 332's enumeration) into
`failing` / `stale-failure` / `ok` / `unknown`: `failing` requires both a
failed last run *and* a certificate inside certbot's 30-day renewal window;
a failed run against a certificate with weeks of slack is `stale-failure` and
deliberately doesn't notify. `unknown` fires whenever `ExecMainExitTimestamp`
is empty — the one field that actually distinguishes "certbot never ran" from
"succeeded," since `Result`'s default masks that distinction.

`status-monitor.ts` sets a new `certRenewalFailing` metric only on the
`failing` classification (mirroring how `certStatus` already worked), which
plugs into a fourth built-in default rule in `alert-rules.ts`
(`certRenewalFailing gt 0`, 24h cooldown, never user-configurable — same as
`certStatus`). The fired alert's notification detail carries certbot's exact
error line via a new contextual `certbotError` metric field.

While extending `cert.ts`'s `cert-details` route with the same `Result`/error
fields, found and fixed the bug backlog.md had flagged as unverified:
`LastTriggerUSec` parsing assumed a raw microsecond epoch value
(`parseInt(timerVal, 10) / 1000`), but `systemctl show` — with or without
`--value` — formats timestamps as human-readable strings
(`Mon 2026-09-14 17:36:20 UTC`), confirmed live on diner-decider. `parseInt`
on that string is `NaN`, so `renewTimerLastRan` was silently `null` on every
real server, always. Fixed to parse the value as a date string directly, same
as the new `ExecMainExitTimestamp` handling.

Live read-only verification against all 7 registered fleet projects (script
run, then deleted — no artifact left in the tree) confirms diner-decider
lands on `stale-failure`, not `failing`, exactly as the sprint's live test
case requires: its certbot timer has been failing on a port-80 conflict
across three separate runs (Sep 13 15:04, Sep 14 10:07, Sep 14 17:36 UTC) but
its certificate isn't due — 89 days remaining, next expiry Dec 13 — so the
30-day-window gate correctly suppresses the alert. Every other project came
back `ok`.

### Files changed
- `apps/api/src/lib/cert-probe.ts` — extends `CERT_PROBE_CMD` with a
  `RESULT=`/`LASTRAN=`/`RENEWERR=` block; adds `extractCertbotSection`,
  `parseCertbotSection`, `CertbotStatus`, `RenewalHealth`,
  `classifyRenewalHealth`; renames `certSectionEndIndex` →
  `probeBlockEndIndex` to point past the new block
- `apps/api/src/lib/cert-probe.test.ts` — classification coverage for all
  four states, including the live diner-decider stale-failure case and a
  real extracted error line
- `apps/api/src/lib/status-monitor.ts` — feeds `certbotStatus`/
  `classifyRenewalHealth` into `AlertMetrics.certRenewalFailing`/
  `certbotError`; `enrichFiredAlert` (now exported) builds the
  error-line detail; uses `probeBlockEndIndex` for the backup-age offset
- `apps/api/src/lib/status-monitor.test.ts` — `enrichFiredAlert` coverage:
  error-line detail, fallback text, non-cert alerts untouched
- `apps/api/src/lib/alert-rules.ts` — `certRenewalFailing` metric and its
  built-in default rule (24h cooldown, non-overridable)
- `apps/api/src/lib/alert-rules.test.ts` — default-rule firing, stale case
  stays silent, updated `resolveRules` counts for the fourth default
- `apps/api/src/routes/cert.ts` — adds `renewalResult`/`renewalError` to
  `CertDetails`; fixes `LastTriggerUSec` date parsing
- `apps/api/src/routes/cert.test.ts` — realistic (not raw-microsecond) fixture
  for `LastTriggerUSec`; new-field coverage; a renewal-failure case
- `backlog.md` — strikes the now-fixed `LastTriggerUSec` item

### Verification
- `pnpm test`: 426/426 pass
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- Live read-only fleet check (real `CERT_PROBE_CMD`, all 7 registered
  projects): `develemail ok`, `diner-decider stale-failure` (quoted above),
  `emit-billing ok`, `emit-social ok`, `emit-vision ok`, `martialops ok`,
  `tastease ok` — diner-decider never classified as `failing`
- `cert-details`'s extended SSH fragment (`RESULT=`/`RENEWERR=`) verified
  directly against both diner-decider (`exit-code` + the port-80 error line)
  and emit-vision (`success`, empty error) before wiring it into the route

### Follow-ups
- `[defer]` diner-decider's certbot renewal itself is still failing (port 80
  in use) as of this sprint's live check — out of scope here (detection
  only), but worth a dedicated fix; it's currently masked from paging only
  because the certificate has 89 days of slack.
- `[defer]` `AlertMetrics`/`Metric` now carries two internal-only members
  (`certStatus`, `certRenewalFailing`) alongside two contextual string
  fields (`certName`, `certbotError`) that are never used as `rule.metric`.
  Sprint 332 flagged revisiting this if a 6th metric arrived; still fine
  structurally, but the next addition is a good point to split "evaluable
  metric" from "notification context" into separate types.
