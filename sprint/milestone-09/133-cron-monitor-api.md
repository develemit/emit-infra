# Sprint 133 — Cron job monitor API

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/cron-jobs` route that SSHes into the server, reads all active cron entries from the standard system cron locations, and returns a parsed, structured list.

## Reason

Silent cron failures are one of the most common invisible problems on self-hosted infrastructure — the job fails, nothing alerts, and the symptom (stale data, missed backups, uncompacted logs) only surfaces much later. The first step is simply knowing what's scheduled.

## Context

- Create `apps/api/src/routes/cron.ts`. Register in `apps/api/src/index.ts` (pattern: `await app.register(cronRoutes)`).
- SSH pattern: same as all other routes — `sshExec`, `findProject`, `sshKeyPath`. See `apps/api/src/routes/projects.ts` lines 1–15 for imports.
- SSH command to collect all cron sources in one round-trip:
  ```bash
  echo '=== /etc/cron.d/ ===' && ls /etc/cron.d/ 2>/dev/null | while read f; do echo "--- /etc/cron.d/$f ---"; cat "/etc/cron.d/$f" 2>/dev/null; done && echo '=== /var/spool/cron/crontabs/root ===' && cat /var/spool/cron/crontabs/root 2>/dev/null || true && echo '=== crontab -l ===' && crontab -l 2>/dev/null || true
  ```
- Parsing rules for each non-comment, non-empty line:
  - Skip lines starting with `#`, `MAILTO=`, `PATH=`, or other `KEY=VALUE` env assignments.
  - Lines with 5 time fields + command: `minute hour dom month dow command...`
  - `/etc/cron.d/` files have a 6th field (username) before command: `minute hour dom month dow user command...`
  - Reconstruct schedule as a string: `"minute hour dom month dow"`.
- Return type:
  ```ts
  interface CronJob {
    schedule: string      // e.g. "0 2 * * *"
    command: string       // the shell command
    user?: string         // present for /etc/cron.d/ entries
    source: string        // e.g. "/etc/cron.d/emit-backup" or "crontab -l"
  }
  ```
  Return `{ jobs: CronJob[] }`.
- TTL cache 120_000ms (cron entries rarely change).
- On SSH failure return 503.

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 1–15 to confirm import paths.
2. Read `apps/api/src/index.ts` to see registration pattern.
3. Create `apps/api/src/routes/cron.ts` with the route.
4. Implement a `parseCronLines(raw: string, source: string, hasUserField: boolean): CronJob[]` helper inside the file that handles the 5-field vs 6-field distinction and skips comment/env lines.
5. Parse the combined SSH output using the section headers (`=== ... ===` and `--- ... ---`) to track which source each block belongs to.
6. Register `cronRoutes` in `apps/api/src/index.ts`.
7. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/cron.ts` — cron jobs route + parsing logic
- `apps/api/src/index.ts` — register cron routes

## Acceptance criteria

- [x] `GET /projects/:name/cron-jobs` returns `{ jobs: CronJob[] }`
- [x] Entries from `/etc/cron.d/` files include a `user` field and the source filename
- [x] `crontab -l` entries have source `"crontab -l"` and no `user` field
- [x] Comment lines and `KEY=VALUE` env lines are skipped
- [x] Returns 503 on SSH failure
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/cron.ts` with a `parseCronOutput` function that walks the combined SSH output, tracking section (`=== ... ===`) and file (`--- ... ---`) headers to know whether to apply 5-field or 6-field parsing. A `parseCronLines` helper skips comments, blank lines, and `KEY=VALUE` env assignments, then splits each remaining line into schedule, optional user, and command. Fixed a variable shadowing error (`raw` loop variable renamed to `line`). 120s TTL cache, 503 on SSH failure.

### Files changed
- (new) `apps/api/src/routes/cron.ts` — cron jobs route + `parseCronOutput`/`parseCronLines` helpers
- `apps/api/src/index.ts` — registered `cronRoutes`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `/var/spool/cron/crontabs/root` may require sudo on some servers; gracefully returns empty due to `2>/dev/null`

## Out of scope

- Dashboard UI (sprint 134)
- Last-run timestamp from syslog (complex to parse reliably — omit for now)
- Cron entries from `/etc/cron.daily/` etc. (these are shell scripts, not crontab lines — skip)
- Editing or disabling cron jobs
