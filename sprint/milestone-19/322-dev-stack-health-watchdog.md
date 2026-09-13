# Add a health watchdog that recovers a silently stopped dev stack
**Difficulty:** 4

## Goal
A launchd watchdog probes the emit-infra API's health endpoint on an interval and
kickstarts `com.emit.infra` when it has been unreachable for several consecutive
probes — so a supervisor that exits without restarting (signal, crash past
`--max-restarts`, orphaned port) self-heals in minutes instead of staying down
until a human notices.

## Reason
Twice now the API has been down for hours with nothing recovering it: 14 hours on
2026-08-23 (`tsx --watch` idling after a child exit, which sprint 310's supervisor
fixed) and ~8 hours on 2026-09-07 (an external SIGTERM, which the supervisor
deliberately does not restart from). Sprint 321 makes the second case *visible*;
it does not make it *recover*.

The gap is structural. `com.emit.infra` runs `caffeinate → pnpm run dev → nx →
serve-supervised.sh`, and launchd's `KeepAlive` watches only the top of that
chain. The API supervisor can exit while `pnpm dev` and the Next dashboard keep
running happily, so launchd sees a live job and never restarts anything — exactly
the failure mode the supervisor itself was built to catch one level down
(`serve-supervised.sh:6-11`: a process check is not enough, only a health probe
catches it). The same argument applies one level up: the only reliable signal that
the stack is healthy is that `http://127.0.0.1:7001/health` answers.

## Context
- `~/Library/LaunchAgents/com.emit.infra.plist` — `RunAtLoad`, `KeepAlive`
  (`Crashed: true`, `SuccessfulExit: false`), `ThrottleInterval: 10`,
  `WorkingDirectory` the repo, logs to `~/.local/log/emit-infra-launchd.log`.
- `package.json` — `launch` is `launchctl kickstart -k gui/$(id -u)/com.emit.infra`
  with a `bootstrap` fallback; `launch:stop` is `launchctl bootout`. These are
  uncommitted working-tree additions; treat them as the supported entry points.
- Precedent for a scheduled agent in this repo: `~/Library/LaunchAgents/com.emit.metrics-collector.plist`
  runs `scripts/collect-metrics.sh` on `StartInterval: 300`, and
  `com.emit.ghcr-prune.plist` runs on a `StartCalendarInterval`. Follow that shape —
  a plain script in `scripts/`, a plist, logs under `~/.local/log/`.
- **The hard constraint:** the watchdog must not fight a deliberate stop. When the
  user runs `pnpm launch:stop` (`launchctl bootout`), the job is unloaded on
  purpose; a watchdog that kickstarts it back is a bug, not a feature. Detect this
  by asking launchd whether the job is loaded (`launchctl print gui/$UID/com.emit.infra`
  or `launchctl list com.emit.infra`) and doing nothing when it is not — an
  unloaded job is an intentional stop. Do not invent a marker file if launchd
  already answers the question.
- Reuse `_svsup_probe_health` from `scripts/lib/serve-supervised-lib.sh` rather
  than writing another curl invocation, and note `_svsup_lsof_bin` exists because
  launchd's PATH is minimal — the plist must set `PATH` the same way
  `com.emit.infra.plist` does.
- Health endpoint: `http://127.0.0.1:7001/health` (the supervisor probes the same
  URL, built from `${PORT:-7001}`).
- This project has no `check:affected` script; its suite is `pnpm test:hooks`,
  `pnpm test`, `pnpm typecheck`, `pnpm lint`. Bash tests follow the pattern in
  `scripts/lib/*.test.sh` and are registered in `package.json`'s `test:hooks`.

## Tasks
1. Write `scripts/dev-stack-watchdog.sh`: probe the health URL; on success reset
   state and exit; on failure increment a persisted consecutive-failure counter
   under `~/.local/state/` (or similar) and only act at a threshold (default 3).
2. Before acting, confirm the launchd job is loaded. If it is not, clear the counter
   and exit silently — an unloaded job means `launch:stop` was run deliberately.
3. On action, `launchctl kickstart -k gui/$UID/com.emit.infra`, log a clear line
   with a timestamp to `~/.local/log/dev-stack-watchdog.log`, and reset the counter.
4. Rate-limit recovery: refuse to kickstart more than N times per hour (default 3)
   and log loudly when that ceiling is hit, so a genuinely broken stack produces a
   readable "I gave up" line instead of a restart loop every interval.
5. Accept flags for health URL, label, threshold, and ceiling so the same script can
   later supervise develemit-hq's `com.develemit.hq` job; default to emit-infra.
6. Add `~/Library/LaunchAgents/com.emit.dev-stack-watchdog.plist` with
   `StartInterval` (120s), an explicit `PATH` matching `com.emit.infra.plist`, and
   `StandardOutPath`/`StandardErrorPath` under `~/.local/log/`. Commit a copy in the
   repo next to the other agent plists if that convention exists; otherwise document
   the file in the sprint's docs task.
7. Add `scripts/lib/dev-stack-watchdog.test.sh` with the probe, launchd-state, and
   kickstart calls injected as overridable commands (the existing bash tests stub
   externals this way) covering: healthy → no action; N-1 failures → no action;
   N failures → one kickstart; job unloaded → no action even at threshold; ceiling
   reached → no kickstart plus a give-up log line. Register it in `test:hooks`.
8. Document the watchdog in `docs/DEV-SERVER-SUPERVISOR.md`: what it does, why
   launchd's KeepAlive cannot do it, and how to disable it.

## Files involved
- new file: `scripts/dev-stack-watchdog.sh` — the probe/kickstart loop body
- new file: `scripts/lib/dev-stack-watchdog.test.sh` — unit coverage with injected externals
- new file: `~/Library/LaunchAgents/com.emit.dev-stack-watchdog.plist` — 120s interval agent
- `package.json` — register the new test in `test:hooks`
- `scripts/lib/serve-supervised-lib.sh` — reuse `_svsup_probe_health` (read-only if it already fits)
- `docs/DEV-SERVER-SUPERVISOR.md` — document the watchdog layer

## Acceptance criteria
- [x] With the API stopped and the job still loaded, the watchdog kickstarts `com.emit.infra` after the threshold and the API answers `/health` again
- [x] After `pnpm launch:stop`, the watchdog takes no action on any number of runs
- [x] A healthy stack produces no kickstart and no log spam
- [x] The hourly ceiling prevents more than N kickstarts and logs a give-up line
- [x] `scripts/lib/dev-stack-watchdog.test.sh` covers all five cases in task 7 and is registered in `pnpm test:hooks`
- [x] `pnpm test:hooks` passes

## Out of scope
- Watching develemit-hq (`com.develemit.hq`) — the script takes flags for it, but wiring its plist is a follow-up
- Notifications/alerting when the watchdog fires — the log line is enough for now
- Replacing launchd's `KeepAlive` or restructuring the `caffeinate → pnpm → nx` chain
- Anything to do with the fleet's production servers; this is local dev only

## Completed

**Date:** 2026-09-07

### Summary
Added `scripts/dev-stack-watchdog.sh`, a launchd `StartInterval` job that probes
`com.emit.infra`'s health endpoint and self-heals the gap `KeepAlive` structurally
can't see: the API supervisor can exit on an external `SIGTERM` (sprint 321's
"signalled" reason) while `pnpm dev`/the dashboard keep running, so launchd sees a
live job and never restarts anything. The script reuses `_svsup_probe_health`
from `scripts/lib/serve-supervised-lib.sh` rather than a second curl invocation,
persists a consecutive-failure counter and a rolling-hour kickstart history under
`~/.local/state/dev-stack-watchdog/`, and treats an *unloaded* launchd job
(`launchctl print` failing) as a deliberate `pnpm launch:stop` — clearing state
and doing nothing rather than fighting the user's own stop.

Design choice worth flagging: the counter increments on every failed probe
*before* the loaded-job check, then gets cleared if the job turns out to be
unloaded — this mirrors the sprint's task ordering (task 1 increments-on-failure,
task 2 gates action on load state) rather than short-circuiting before the
increment. Behaviorally identical either way (the counter always ends at 0 when
unloaded), but keeping the literal order made the code easier to map back to the
spec.

All five acceptance criteria that describe live behavior were verified against
the real, running `com.emit.infra` job, not just simulated in the test harness:
sent a real `SIGTERM` to the running API supervisor (pid confirmed via `ps`),
confirmed `/health` failed while `launchctl print` still showed the job loaded
(the exact gap this sprint targets), ran the watchdog three times, and confirmed
it kickstarted the job and `/health` answered again. Separately ran
`pnpm launch:stop`, confirmed `launchctl print` now fails (rc 113), and confirmed
5 consecutive watchdog runs took no action. Restored the stack afterward with
`pnpm launch`. The plist was also bootstrapped for real
(`~/Library/LaunchAgents/com.emit.dev-stack-watchdog.plist`, `plutil -lint`
clean) and one live `launchctl kickstart` of the watchdog job itself confirmed
the healthy path produces zero log output.

Per the sprint's own note, no committed-plist convention exists in this repo yet
(no `.plist` files were found under version control before this sprint), so the
plist lives only under `~/Library/LaunchAgents/` and is documented in
`docs/DEV-SERVER-SUPERVISOR.md` instead of being committed.

### Files changed
- (new) `scripts/dev-stack-watchdog.sh` — probe/kickstart loop; flags for url,
  label, threshold, ceiling, state-dir, log-file; sourceable for tests via the
  same `BASH_SOURCE` guard as `serve-supervised.sh`
- (new) `scripts/lib/dev-stack-watchdog.test.sh` — stubs `curl`/`launchctl` as
  shell functions (same injection shape as `docker-build.test.sh`), covers all
  five cases from task 7
- `package.json` — registered the new test in `test:hooks`
- `docs/DEV-SERVER-SUPERVISOR.md` — new "watchdog layer" section: what it does,
  why `KeepAlive` can't, how to disable it
- (new, outside repo) `~/Library/LaunchAgents/com.emit.dev-stack-watchdog.plist`
  — 120s `StartInterval` agent, bootstrapped and confirmed loaded

### Verification
- `pnpm test:hooks`: 13/13 new tests pass; full suite (all files, including this
  one) exits 0 with no `FAIL` lines
- `pnpm typecheck`: 5/5 projects clean (sanity check for the root `package.json`
  edit; this sprint's own work is pure bash/docs, outside the Nx project graph)
- Live end-to-end: real `SIGTERM` → API down, job still loaded → 3 watchdog runs
  → kickstart fired → `/health` recovered
- Live end-to-end: `pnpm launch:stop` → job unloaded → 5 watchdog runs → zero
  kickstarts, counter stays at 0
- Live: healthy stack → `launchctl kickstart` of the watchdog job itself →
  empty log, counter reset to 0
- `plutil -lint` on the plist: OK; `launchctl print` after bootstrap shows the
  job registered with the expected program/stdout/stderr paths

### Follow-ups
- `[defer]` Wiring develemit-hq's `com.develemit.hq` job through the same
  script (flags already support it) — explicitly out of scope for this sprint
- `[defer]` No notification/alerting on watchdog action beyond the log line —
  also explicitly out of scope
- `[defer]` This repo has no committed-plist convention yet; if a second
  scheduled agent gets added later it may be worth deciding whether to commit
  plists under e.g. `scripts/launchd/` for reviewability, rather than leaving
  them only in `~/Library/LaunchAgents/`
