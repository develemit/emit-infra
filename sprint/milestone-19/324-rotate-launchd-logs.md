# Bound the launchd stdout logs so they stop growing without limit
**Difficulty:** 2

## Goal
`~/.local/log/*-launchd.log` is size-capped and rotated like the supervisor's own
log, so a stack that spends hours failing cannot produce a 95 MB file that is
impractical to read during an incident.

## Reason
The supervisor already solved this one level down: `_svsup_rotate_log` caps its
log at 5 MB and keeps 10 archives (`serve-supervised.sh:49-50`), and
`~/.local/log/develemit-hq/` holds exactly those rotated archives. But the file
launchd itself writes — `StandardOutPath`/`StandardErrorPath` on the plist — has
no cap at all. Today `develemit-hq-launchd.log` is **95 MB** and
`emit-infra-launchd.log` is **10 MB**.

That directly cost time on 2026-09-07. The one line that explained the outage
(`received SIGTERM — forwarding to child, exiting without restart`) was buried
under thousands of `Failed to proxy http://localhost:7001/... ECONNREFUSED` lines
emitted by Next.js's rewrite proxy every time the dashboard polled a dead API —
noise generated *by* the outage, at a volume that grows with its duration. The
proxy lines come from inside Next and cannot be rate-limited from our code, so the
fix belongs at the log layer: bound the file and rotate it.

## Context
- `_svsup_rotate_log <file> <max-bytes> <archive-dir> <max-keep>` in
  `scripts/lib/serve-supervised-lib.sh` is the existing, tested implementation —
  archives are named like `develemit-hq-20260907T161340Z-25573-9.log`. Reuse it;
  do not write a second rotation routine.
- Agents writing unbounded logs today:
  `com.emit.infra` → `~/.local/log/emit-infra-launchd.log`,
  `com.develemit.hq` → `~/.local/log/develemit-hq-launchd.log`,
  plus `metrics-collector.log` (9.5 MB) from `com.emit.metrics-collector`.
- launchd holds the file descriptor for `StandardOutPath`, so **renaming the file
  out from under it does not work** — the daemon keeps writing to the old inode and
  the new file stays empty. Truncate in place (copy the tail to an archive, then
  `: > "$file"`) rather than `mv`. Verify this against a running agent before
  declaring the sprint done; getting it wrong silently loses all future logging.
- Precedent for a scheduled maintenance agent: `com.emit.ghcr-prune.plist`
  (`StartCalendarInterval`) and `com.emit.metrics-collector.plist` (`StartInterval: 300`).
- This project has no `check:affected` script; its suite is `pnpm test:hooks`,
  `pnpm test`, `pnpm typecheck`, `pnpm lint`. Bash tests live in `scripts/lib/*.test.sh`
  and are registered in `package.json`'s `test:hooks`.

## Tasks
1. Write `scripts/rotate-launchd-logs.sh` that takes a list of log paths (defaulting
   to the three known agent logs) and applies a size cap using the existing
   `_svsup_rotate_log` helper, adapted for the truncate-in-place constraint above.
2. Implement rotation as: if size > cap, copy the last N bytes (or whole file) to
   `<archive-dir>/<name>-<UTC timestamp>.log`, then truncate the original in place
   with `: > "$file"` so launchd's open descriptor keeps working. Keep at most 5
   archives per log, deleting oldest first.
3. If `_svsup_rotate_log` cannot be reused as-is because it renames rather than
   truncates, extend it with a truncate mode instead of forking the logic — and
   keep its existing callers' behavior identical.
4. Schedule it: `~/Library/LaunchAgents/com.emit.log-rotate.plist` on a
   `StartInterval` (hourly is plenty), with an explicit `PATH` like the other agent
   plists.
5. One-time cleanup: rotate the current 95 MB and 10 MB files as part of the sprint
   so the repo's dev environment starts from a sane state.
6. Add coverage in `scripts/lib/` (new `rotate-launchd-logs.test.sh` or extend
   `serve-supervised.test.sh` if the helper changed): a file over cap is archived and
   truncated to zero; **the original file's inode is unchanged after rotation**
   (this is the launchd-descriptor guarantee, and the test that stops a regression
   from silently killing logging); a file under cap is untouched; only `max-keep`
   archives survive. Register any new test file in `test:hooks`.
7. Document the rotation in `docs/DEV-SERVER-SUPERVISOR.md` alongside the
   supervisor's own log rotation.

## Files involved
- new file: `scripts/rotate-launchd-logs.sh` — size-capped truncate-in-place rotation for agent logs
- new file: `scripts/lib/rotate-launchd-logs.test.sh` — coverage including the inode-preservation assertion
- new file: `~/Library/LaunchAgents/com.emit.log-rotate.plist` — hourly agent
- `scripts/lib/serve-supervised-lib.sh` — only if `_svsup_rotate_log` gains a truncate mode
- `package.json` — register the new test in `test:hooks`
- `docs/DEV-SERVER-SUPERVISOR.md` — document log rotation

## Acceptance criteria
- [x] A launchd log over the cap is archived and truncated, and the **inode is unchanged** so the running agent keeps writing to it
- [x] A log under the cap is left alone
- [x] At most `max-keep` archives survive per log, oldest deleted first
- [x] Existing `_svsup_rotate_log` callers behave identically (no regression in `serve-supervised.test.sh`)
- [x] `develemit-hq-launchd.log` and `emit-infra-launchd.log` are back under the cap after the one-time cleanup
- [x] New tests are registered in and pass under `pnpm test:hooks`

## Out of scope
- Silencing Next.js's `Failed to proxy` lines — they originate inside Next's rewrite proxy, not our code
- Switching any app to structured/JSON logging
- Rotating production server logs on the fleet (those are managed by the servers' own logrotate)
- Changing what any agent logs; this sprint only bounds where it lands

## Completed

**Date:** 2026-09-07

### Summary
`_svsup_rotate_log` (sprint 310) already truncates in place rather than
renaming — `cp` the tail to an archive, then `: > "$file"` — so it needed no
changes at all; it was reused directly against the launchd-owned files
instead of the supervisor-mirrored ones. `scripts/rotate-launchd-logs.sh`
takes a list of log paths (defaulting to the three known unbounded agent
logs), applies a 5MB cap with 5 archives kept per log, archived into a
sibling directory named after the log's own basename
(`~/.local/log/<name>/`, mirroring the supervisor's `log_dir/${NAME}`
convention). Scheduled hourly via `com.emit.log-rotate.plist`
(`StartInterval`), which is bootstrapped and running.

Verified the inode-preservation guarantee two ways: the unit-test suite
(fixture files), and a live end-to-end check against a real background
writer appending to a file every 200ms while rotation truncated it mid-write
— the inode was identical before/after and the writer kept appending
correctly to the truncated file with no gap or error, which is the exact
behavior launchd's held `StandardOutPath` fd depends on. The one-time
cleanup ran via the first real kickstart of the new agent (not a separate
step): `develemit-hq-launchd.log` dropped from 95MB to 89 bytes and
`emit-infra-launchd.log` from 10MB to 0 bytes, both archived intact, both
confirmed still growing afterward (develemit-hq's went 89→334 bytes within
3 seconds of the rotation, proving launchd's fd survived it).

### Files changed
- (new) `scripts/rotate-launchd-logs.sh` — size-capped truncate-in-place rotation for the three known launchd-owned agent logs, CLI flags `--log`/`--max-bytes`/`--max-keep`
- (new) `scripts/lib/rotate-launchd-logs.test.sh` — coverage including the inode-preservation assertion, under-cap no-op, max-keep capping, and default log list
- (new) `~/Library/LaunchAgents/com.emit.log-rotate.plist` — hourly agent, bootstrapped and confirmed running clean (`last exit code = 0`)
- `package.json` — registered `rotate-launchd-logs.test.sh` in `test:hooks`
- `docs/DEV-SERVER-SUPERVISOR.md` — new "The launchd log layer" section documenting the rotation, its rename-doesn't-work constraint, and how to disable it
- `~/.local/log/emit-infra-launchd.log`, `~/.local/log/develemit-hq-launchd.log` — one-time cleanup, both rotated back under cap (not a repo file, noted for completeness)

### Verification
- `pnpm test:hooks`: 10/10 new tests pass, plus full suite (including `serve-supervised.test.sh` unmodified: 29/29) — no regression in existing callers
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- `pnpm test`: full 387/387 pass (touched root `package.json`, so ran the full suite rather than substituting an affected variant — this project has no `check:affected` script)
- Manual: real launchd agent bootstrapped, kickstarted once, `last exit code = 0`; live-writer inode check passed against both a synthetic fixture and production logs during the one-time cleanup

### Follow-ups
- `[defer]` `dev-stack-watchdog.log`, `emit-infra-dashboard.log`, and other `~/.local/log/*.log` files outside the three named in this sprint are still unbounded (smaller today, but nothing stops them growing) — could be added to the default `--log` list in a later pass
- `[defer]` `com.emit.log-rotate` has no equivalent to `dev-stack-watchdog`'s "unloaded means don't act" guard — not needed today since rotation is idempotent and harmless if a target log doesn't exist, but worth a note if the script ever grows side effects beyond file rotation
