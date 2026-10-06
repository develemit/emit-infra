# Route every alert source through notify() and make backup alerts default-on
**Difficulty:** 3

## Goal
Every place that calls `sendToAll()` today calls `notify()` (from sprint 356)
with the right severity, so downtime, cert, disk, backup, failed-deploy and
weekly-digest alerts arrive by email. Backup staleness and backup failure
alert by default, the same way cert alerts already do.

## Reason
Sprint 356 built the email channel, but nothing uses it yet. Backup alerting
is opt-in today (`backupAgeHours` is not in `DEFAULT_CERT_RULES`), and no
fleet project has opted in. A backup that has silently stopped is the most
expensive failure there is to find out about late.

## Context
`sendToAll` call sites, as of 2026-10-06:
- `apps/api/src/lib/health-notify.ts:39`: SSH/HTTP down, reminder and up
  events. down/reminder/up → `alert`. Recovery mail matters because it
  closes the loop on a down email.
- `apps/api/src/lib/status-monitor.ts:227`: fired alert rules
  (`formatAlertNotification`) → `alert`.
- `apps/api/src/routes/deploy.ts:92` (deploy complete) → `info`, push only.
  Emailing every deploy is noise.
- `apps/api/src/routes/deploy.ts:126` (deploy failed) → `alert`.
- `apps/api/src/lib/digest-scheduler.ts:99`: weekly digest → `info` with
  `email: true`, using the `digest.ts` renderer from sprint 356.1.

**Every alert email goes through a sprint 356.1 renderer**
(`apps/api/src/lib/email-templates/`: `health`, `alert-rule`, `deploy`,
`digest`). Pass the result as the structured `email` field on
`notify()`. This sprint's job at each call site is to **gather the data**
the renderer needs:
- server IP and domain from the project config;
- recent incidents from `.incidents.jsonl`;
- 24h metric history plus `computeLinearTrend` for disk/mem;
- deploy sha, branch, build number, duration and error;
- cert name and certbot error;
- backup lastRun and status.
Don't hand-build HTML anywhere. Data gathering must be best-effort: if
history can't be read, the email still sends with the facts it has.
- `apps/api/src/routes/push.ts:58`: test endpoint, already moved in 356.

Alert rules (`apps/api/src/lib/alert-rules.ts`):
- `DEFAULT_CERT_RULES` and `resolveRules()` merge built-ins with
  `config.alertRules`.
- Add backup defaults:
  - `backupAgeHours gt 30`, with a 12h cooldown;
  - a new built-in metric `backupFailed gt 0`, 1 when `.backup-status.json`
    says `"status":"failed"`, with a 12h cooldown.
- A project's own `backupAgeHours` rule replaces the age default, the same way
  `certDays` overrides work.
- Rename `DEFAULT_CERT_RULES` → `DEFAULT_RULES` (keep the cert entries
  grouped), and update the file's doc comment, which currently says
  "everything besides certificates remains fully opt-in".

Backup status probe:
- `apps/api/src/lib/status-monitor.ts` ≈line 98 greps only `lastRun` out of
  `/opt/<name>/.backup-status.json`.
- Extend the probe to also pull `status`.
- Set `metrics.backupFailed = 1` only when `status === "failed"`.
- **Projects with no status file must stay silent.** Leave `backupAgeHours`
  undefined so they don't fire, matching how `certStatus` avoids "breach by
  omission". Sprint 359 brings every DB project onto the status-file
  contract.

## Tasks
1. Replace each `sendToAll` call site with `notify()` and the severity listed
   above. Keep the existing `tag`/`url` values and the existing
   `.catch()`/logging behaviour.
2. At each call site, gather the renderer's input data (see Context) and
   pass the rendered `email` to `notify()`. Shared lookups (incidents in the
   last 7 days, the last 24h of metrics) go in one helper,
   `apps/api/src/lib/email-context.ts`, not duplicated across call sites.
3. Add the backup defaults and the `backupFailed` metric to
   `alert-rules.ts`. Extend `AlertMetrics`. Add a label to the
   `status-monitor.ts` metric-label map (≈line 28).
4. Extend the backup probe to read `status`.
5. `status-monitor.ts` is 248 lines. If your change pushes it past ~280,
   extract the probe-output parsing (cert/backup sections) into
   `lib/probe-parse.ts`.
6. Restart the API with `pnpm launch`. Trigger a real down→up cycle by
   pointing a throwaway project's `healthCheck.url` at a dead port, or use
   the `test-smoke` project. Confirm the down email and the recovery email
   both arrive, then revert.

## Files involved
- `apps/api/src/lib/health-notify.ts`, `status-monitor.ts`,
  `digest-scheduler.ts`, `weekly-digest.ts`
- `apps/api/src/routes/deploy.ts`
- `apps/api/src/lib/alert-rules.ts` (+ `alert-rules.test.ts`)
- new: `apps/api/src/lib/email-context.ts` (+ test)
- possibly new: `apps/api/src/lib/probe-parse.ts`

## Acceptance criteria
- [ ] `grep -rn sendToAll apps/api/src --include='*.ts' | grep -v test` shows
      only `push.ts` (definition) and `notify.ts`.
- [ ] `alert-rules.test.ts` covers:
  - backup-age default fires at 31h and not at 29h;
  - a project override replaces it;
  - `backupFailed` fires;
  - a missing status file fires nothing.
- [ ] `health-notify` and deploy tests (existing or new) assert the severity
      passed to `notify()` for down, up and deploy-failed versus
      deploy-complete.
- [ ] `email-context.test.ts` covers incidents and metric-history lookups,
      including the unreadable/missing-file case returning empty rather
      than throwing.
- [ ] Call-site tests assert that `notify()` receives a structured `email`
      from the matching renderer (health, alert-rule, deploy-failed, digest)
      and that the weekly digest email contains each project name.
- [ ] A live down→up email pair was received (the user confirmed).
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.

## Out of scope
- Email throttling beyond the existing cooldowns and reminders.
- Making the status file exist on every server (sprint 359).
- Dashboard UI for notification settings.
