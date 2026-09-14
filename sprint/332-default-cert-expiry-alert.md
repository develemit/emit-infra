# Alert on expiring TLS certificates fleet-wide, without per-project setup
**Difficulty:** 4

## Goal
Every fleet server gets a push notification well before any of its TLS
certificates expires — with no per-project configuration — and a server whose
certificate expiry can't be read is flagged instead of silently ignored.

## Reason
On 2026-09-13 at 15:49 UTC diner-decider's Let's Encrypt certificate expired and
the site served Cloudflare 526 for ~27 hours. certbot starts renewing 30 days
before expiry, and every one of its runs had been failing, so the problem was
detectable from roughly 2026-08-14 onward. emit-infra already has the pieces
for this — `certDays` is an alert metric in `apps/api/src/lib/alert-rules.ts`,
computed every 60s in `status-monitor.ts` — yet it never fired, for two reasons
verified on 2026-09-14:

1. **The alert is opt-in and no project opted in.** Rules come from
   `config.alertRules ?? []`. All seven projects' `.emit-infra.json` have no
   `alertRules`, and no `.alerts.jsonl` exists anywhere in the fleet. The alert
   has never been able to fire for anyone. Configuring it per project would
   repeat the failure the moment a new project is added.
2. **The metric silently disappears when a domain isn't a certificate name.**
   `probeProject` reads `/etc/letsencrypt/live/${domain}/fullchain.pem`.
   emit-vision's `domain` is `emitvision.com`, but its only certificate is
   `api.emitvision.com`, so `certDays` is always `undefined` — and
   `evaluateRules` skips undefined metrics without a trace. tastease's server
   also holds `api.martialops.app`, which the domain-based read never looks at.

## Context

### The monitor
- `apps/api/src/lib/status-monitor.ts` (246 lines) — `poll()` runs every 60s per
  project; `probeProject()` builds one SSH command (disk, memory, cert expiry via
  `openssl x509 -enddate`, backup age) and parses it line by line. It's near the
  300-line limit; extract cert probing into a new `lib/cert-probe.ts` rather than
  growing it.
- `apps/api/src/lib/alert-rules.ts` — `evaluateRules()` with a single global
  `COOLDOWN_SEC = 6 * 3600`. Rules re-arm when no longer breached.
- Fired alerts go to `sendToAll()` (push, `lib/push.ts`) via
  `formatAlertNotification()` and are appended to the project's `.alerts.jsonl`.
  Push subscribers exist on this machine (a test notify returned `"sent":2`).
- Rule schema: `packages/types/src/project-config.ts` (`AlertRuleItemSchema`,
  `alertRules` optional). `apps/api/src/routes/projects.ts:77` accepts rule edits.

### Fleet certificates, audited 2026-09-14 (all valid)
| server | certificates | expires |
|---|---|---|
| develemail | develemail.com | 2026-11-30 |
| diner-decider | dinerdecider.com | 2026-12-13 |
| emit-billing | billing.develemit.com | 2026-11-01 |
| emit-vision | api.emitvision.com | 2026-11-03 |
| martialops | martialops.app | 2026-11-24 |
| tastease | tastease.app, api.martialops.app | 2026-11-12 / 11-20 |

emit-social wasn't audited (its config has no `serverIp`; the monitor uses
`domain` as the SSH host). Verify it as part of this sprint.

### Thresholds, anchored to certbot's behaviour
certbot renews at 30 days remaining. A certificate still under **21 days** means
renewal has been failing for over a week — worth a daily reminder. Under **7
days** is urgent — every 6 hours. Don't alert above 21 days: certs routinely
sit at 30 days for a few hours until the next twice-daily timer run.

### Conventions
Vitest; tests sit beside source (`alert-rules.test.ts`, `status-monitor.test.ts`).
This repo has no `check:affected`; the suite is `pnpm test`, `pnpm typecheck`,
`pnpm lint`. emit-infra is local-only, never deployed.

## Tasks
1. Create `apps/api/src/lib/cert-probe.ts`. Instead of one path derived from
   `domain`, list every certificate under `/etc/letsencrypt/live/*/fullchain.pem`
   on the server (skip the `README` entry) and parse each name and `notAfter`.
   Keep it inside the existing single SSH call — no extra round trip per poll.
2. Expose the **soonest-expiring** certificate per project: its name and days
   remaining. `certDays` becomes that value.
3. Make "couldn't read any certificate" explicit (e.g. a `certStatus: 'unknown'`
   alongside metrics) rather than an absent value. A project that has a domain
   but yields no readable certificate should produce one notification, not
   silence.
4. Add built-in default rules in `alert-rules.ts` that apply to every project:
   `certDays lt 21` with a 24h cooldown, and `certDays lt 7` with a 6h cooldown.
   A project's own `certDays` rules replace the defaults for that metric; all
   other metrics stay opt-in exactly as today. Support per-rule cooldowns
   internally without requiring a config-schema change.
5. Make the notification actionable: name the certificate, the days left, and say
   that certbot should have renewed it at 30 days, so renewal is failing on that
   server.
6. Slim `status-monitor.ts` by delegating to `cert-probe.ts`; keep it under 300 lines.
7. Tests (below), then verify against the real fleet — read-only: every project
   yields a certificate name and `certDays`, including emit-vision
   (`api.emitvision.com`) and emit-social, or an explicit unknown.

## Files involved
- new file: `apps/api/src/lib/cert-probe.ts` — enumerate and parse server certificates
- new file: `apps/api/src/lib/cert-probe.test.ts`
- `apps/api/src/lib/status-monitor.ts` — delegate cert probing; feed the unknown state
- `apps/api/src/lib/alert-rules.ts` — default rules, per-rule cooldown
- `apps/api/src/lib/alert-rules.test.ts` — defaults, override, cooldown cases
- `apps/api/src/lib/status-monitor.test.ts` — notification text

## Acceptance criteria
- [x] With no `alertRules` in any `.emit-infra.json`, a project whose soonest
      certificate has 20 days left produces a notification; 22 days does not
- [x] The `lt 21` tier re-notifies at most daily; the `lt 7` tier every 6 hours
- [x] A project's own `certDays` rules replace the defaults; other metrics stay opt-in
- [x] Certificates are read from every `/etc/letsencrypt/live/*` entry, not
      `live/<domain>` — emit-vision's `api.emitvision.com` gets a value; quote it
- [x] A server with no readable certificate yields an explicit unknown state and a
      notification, never a silently skipped metric
- [x] The notification names the certificate and days remaining and says
      renewal is failing
- [x] Read-only check against the live fleet lists the soonest certificate and
      days remaining for all seven projects, including emit-social
- [x] Coverage in `cert-probe.test.ts` (multiple certs, `README` skipped,
      unparseable date, none present) and `alert-rules.test.ts` (defaults,
      override, per-rule cooldown)
- [x] `status-monitor.ts` stays under 300 lines
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass (this repo has no `check:affected`)

## Out of scope
- Detecting that certbot renewal itself is failing before the countdown starts —
  sprint 333.
- Flapping and repeated outage notifications — sprint 334.
- Fixing Ansible certbot provisioning — sprint 335.
- Dashboard UI changes beyond what the existing status and alert views already show.

## Completed

**Date:** 2026-09-14

### Summary
Certificate expiry is now a fleet-wide default: every project gets a `certDays
lt 21` (24h cooldown) and `certDays lt 7` (6h cooldown) alert with no config
needed, and a new `certStatus` default alert (24h cooldown) fires when a
project's server has no readable certificate at all, closing the silent-skip
gap that let diner-decider's expiry go unnoticed.

New `apps/api/src/lib/cert-probe.ts` replaces the old single-path
`live/<domain>/fullchain.pem` read with a glob over every
`/etc/letsencrypt/live/*/fullchain.pem` entry, parsed inside the same SSH call
`status-monitor.ts` already makes (marker-delimited so it splices cleanly into
the existing line-based parsing) — no extra round trip per poll. It exposes
the soonest-expiring certificate's name and days remaining; when no
certificate parses, `certStatus: 1` is set explicitly instead of leaving
`certDays` `undefined` (which `evaluateRules` had always skipped without a
trace).

`alert-rules.ts` gained `resolveRules()`, which merges a project's own
`alertRules` with the built-in cert defaults: a project's own `certDays` rule
replaces *both* default tiers, everything else (including the `certStatus`
default) is untouched, and all other metrics remain fully opt-in exactly as
before. `evaluateRules()` now takes a per-rule `cooldownSec` (defaulting to
the existing 6h global when absent), so the two `certDays` tiers can run 24h
and 6h cooldowns without changing the user-facing config schema — `AlertRule`
in `project-config.ts` is untouched; `certStatus` isn't part of that schema
either, it only exists inside `alert-rules.ts`'s internal rule type.

Notifications for `certDays`/`certStatus` alerts now carry a `detail` string
(certificate name, days left, and "certbot should have renewed it at 30 days,
so renewal is failing") instead of the generic `metric value op threshold`
line; other metrics are unaffected and keep the original format.

Verified read-only against the live fleet (all 7 registered projects,
including emit-social which has no `serverIp` and falls back to `domain` as
the SSH host): every project returned a valid `CERT|name|notAfter` line,
including emit-vision's `api.emitvision.com` (previously always `undefined`)
and tastease's two certificates (`tastease.app` soonest at Nov 12, ahead of
`api.martialops.app`'s Nov 20). No project hit the unknown-certificate path
right now — the whole fleet's certs are currently valid per the sprint's own
audit table — so `certStatus` fires only exercised through unit tests.

### Files changed
- (new) `apps/api/src/lib/cert-probe.ts` — glob + parse every
  `/etc/letsencrypt/live/*` cert in one SSH round trip; exposes
  `extractCertSection`, `parseCertLines`, `soonestExpiring`
- (new) `apps/api/src/lib/cert-probe.test.ts` — multiple certs, README
  skipped, unparseable date, none present
- `apps/api/src/lib/status-monitor.ts` — delegates cert probing to
  `cert-probe.ts`; feeds `certStatus`/`certName` into `AlertMetrics`; builds
  actionable `detail` text for cert alerts; drops the now-unused
  domain-derived cert path and `SAFE_DOMAIN_RE` import
- `apps/api/src/lib/status-monitor.test.ts` — `detail`-aware notification tests
- `apps/api/src/lib/alert-rules.ts` — `resolveRules()`, built-in
  `DEFAULT_CERT_RULES`, per-rule `cooldownSec`, `certStatus` metric
- `apps/api/src/lib/alert-rules.test.ts` — defaults (20d fires/22d doesn't),
  `certStatus` firing, per-rule cooldown (shorter and blocking), `resolveRules`
  override/opt-in coverage

### Verification
- `pnpm test`: 408/408 pass
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- Read-only live-fleet check (raw SSH, same `CERT_PROBE_CMD` shell fragment)
  against all 7 registered projects: every one returned a real certificate —
  develemail.com (Nov 30), dinerdecider.com (Dec 13), billing.develemit.com
  (Nov 1), social.develemit.com (Dec 11), api.emitvision.com (Nov 3),
  martialops.app (Nov 24), tastease.app + api.martialops.app (Nov 12 / Nov 20).
  None fell into the unknown-certificate path.
- `status-monitor.ts` line count: 267 (limit 300)

### Follow-ups
- `[defer]` `evaluateRules`'s `AlertMetrics` indexing (`metrics[rule.metric]`)
  now spans a 5-metric union including the internal-only `certStatus`; if a
  6th built-in-only metric is ever added, revisit whether `EvaluatedRule`
  still wants to stay structurally compatible with the public `AlertRule` type
  or deserves its own explicit conversion function.
- `[defer]` emit-social has no `serverIp` in its `.emit-infra.json` and falls
  back to `domain` as the SSH host — works today because DNS resolves it, but
  it's the only project relying on that fallback; worth adding `serverIp`
  explicitly for consistency with the other six.
