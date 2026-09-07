# Dev server supervisor

`scripts/serve-supervised.sh` keeps a long-lived dev server alive by probing
its **health endpoint**, not its process. Sprint 310.

## Why a process check isn't enough

On 2026-08-23 emit-infra's API was down for ~14 hours and nobody noticed.
`tsx --watch` does not restart a child that exits — it idles waiting for the
next file change. The supervisor process stayed alive, held no listening
socket, had zero children, and looked perfectly healthy in `ps`. The actual
server was a **grandchild** of the process this script launches
(`tsx cli wrapper → watcher → server`), so a plain "is the pid still there"
check is structurally blind to this failure — wrapping `tsx --watch` in a
restart loop does nothing, because tsx never exits. Only a probe of the real
health endpoint catches it.

The death was also unrecorded: output went to a raw TTY, so there was
nothing to read afterward. That's the other half of what this script fixes —
every death is appended as one JSON line, and output is captured to a log
file, not just the terminal.

## Why bash, not TypeScript

A Node-based supervisor can't supervise a broken Node install or a failed
module resolution — it dies with the thing it's supposed to watch. Bash has
no such dependency, and it sidesteps the stale `apps/cli/dist` trap this repo
keeps hitting.

## Usage

```bash
scripts/serve-supervised.sh --name <slug> --health-url <url> \
  [--dir <path>] [--interval <s>] [--failures <n>] [--max-restarts <n>] \
  [--probe-timeout <s>] [--hold-file <path>] [--hold-stale <s>] [--hold-max <s>] \
  -- <command...>
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--name` | *(required)* | Identifies this server in logs and death records |
| `--health-url` | *(required)* | Polled every `--interval` seconds |
| `--dir` | cwd | Where `.server-deaths.jsonl` is written |
| `--interval` | 5 | Seconds between health probes |
| `--failures` | 3 | Consecutive failed probes before treating the server as dead — a single blip doesn't trigger a restart |
| `--max-restarts` | 10 | Stop restarting (and print a banner) after this many consecutive deaths |
| `--probe-timeout` | 3 | Per-probe `curl` timeout |
| `--hold-file` | *(none)* | While this file is fresh, defer a health-timeout restart. Relative paths resolve against `--dir` |
| `--hold-stale` | 30 | How recently `--hold-file` must have been touched to count as held |
| `--hold-max` | 900 | Longest a single unhealthy episode may be deferred |

Example, wrapping the API's dev server:

```bash
scripts/serve-supervised.sh --name emit-infra-api --health-url http://127.0.0.1:7001/health \
  -- pnpm --filter @emit-infra/api dev
```

This is meant to run **inside** the develemit-hq dashboard's PTY panels, the
same way the raw dev command does today — that workflow (watching output
live in the dashboard) is load-bearing and this script is designed to sit
in front of it, not replace it. An outer `launchd` layer comes later
(sprint 314); this script is the layer directly wrapping the dev command.

## What it does

1. Before spawning `<command...>`, checks whether `--health-url`'s host:port
   is already held and, if so, tries to reclaim it — see "Reclaiming an
   orphaned port at startup" below (sprint 325).
2. Starts `<command...>`, mirroring its output to **both** stdout (so a PTY
   panel still shows it live) and `~/.local/log/<name>.log`.
3. Polls `--health-url` every `--interval` seconds. `--failures` consecutive
   failures counts as death.
4. On death: snapshots the process **tree** and kills all of it (not just the
   top pid — the real listener is often a grandchild), waits for *every* pid
   in that snapshot to go away, escalating to `SIGKILL` for stragglers, then
   waits for the port to release, then restarts with exponential backoff
   (1s, 2s, 4s… capped at 60s).
5. If the port is *still* held after all that, `SIGKILL`s whatever is
   listening on it. A grandchild that reparents to pid 1 mid-teardown keeps
   the socket, and every subsequent start then dies instantly — on
   `EADDRINUSE`, or for `next dev` on "Another next dev server is already
   running" — until something reaps it. Loopback health URLs only.
6. An `EXIT` trap kills the child tree as a backstop on any exit this script
   didn't plan for (sprint 325) — it cannot fire on `SIGKILL`, only on the
   script's own unplanned errors; see below for the case that actually
   matters, which is the *next* start's pre-spawn reclaim, not this trap.
7. `Ctrl-C` (`SIGINT`/`SIGTERM`) forwards to the child and exits — this is a
   normal stop, not a crash, so it never restarts. It still appends one death
   record with `reason: "signalled"` (sprint 321), so a signalled server
   leaves forensic evidence instead of vanishing silently — see below.
8. After `--max-restarts` consecutive deaths, stops and prints a persistent
   banner instead of spinning silently.

## Deferring a restart with `--hold-file`

A failed probe means "this server did not answer within `--probe-timeout`",
which is not the same as "this server is dead". A supervised dev server that
hosts agent sessions — develemit-hq does — gets its event loop starved
whenever one of those agents starts a heavy job (a full Playwright suite, a
build). Restarting then kills the entire process tree, and the agent doing
that work is *inside* it: the supervisor takes down the very work that caused
the stall, mid-run.

`--hold-file` lets the supervised process say "I'm busy, don't bounce me".
While the file exists and its mtime is newer than `--hold-stale`, a
health-timeout defers instead of killing.

The file's mtime doubles as a liveness signal, which is what makes this safe:
it only stays fresh while the process is alive *and* still running timers, so
a genuinely wedged server stops refreshing it and the hold lapses on its own
with no extra probing. `--hold-max` bounds a single episode as a backstop.

develemit-hq drives this from `src/lib/supervisor-hold.ts`, refreshing
`.supervisor-hold` every 5s while any PTY or headless Claude session is
active, and deleting it as soon as none are.

## Reclaiming an orphaned port at startup

`SIGKILL` (an OOM kill, or `kill -9` by hand) bypasses the TERM/INT traps
above entirely — the dying process never runs them, so it never tears down
its own child tree. The real dev server (a grandchild that reparented to
pid 1) keeps holding the health port, and every subsequent start by a
replacement supervisor fails on it — `EADDRINUSE`, or for `next dev`
"Another next dev server is already running" — until someone kills the
orphan by hand. Sprint 314 first hit this live on develemit-hq; sprint 325
fixes it.

The fix can't be a `KILL` trap — nothing can trap `SIGKILL` in the process
being killed — so it's recovery on the *next* start instead of cleanup on
death. Before spawning `<command...>`, the main loop always runs
`_svsup_reclaim_port` against `--health-url`'s host:port — not gated behind a
cheaper single-shot connect-attempt check first. That check was the first
version of this fix, and it was wrong: a one-shot `nc` probe can flake on a
loaded box (the probe itself stalls long enough to read as "free" when it
isn't), which silently skips the reclaim on exactly the runs where the
machine is busiest and a stale orphan is most likely to already be sitting on
the port. `_svsup_reclaim_port`'s own `lsof`-based lookup is authoritative and
already a fast no-op when nothing is listening, so there's no real check left
to save by pre-filtering it:

1. If nothing's listening, it's a no-op and the loop spawns as normal.
2. If something is, fetch its full command line (`ps -ww`, not the default
   truncated one — `ps` truncates to terminal width, which silently breaks
   this check when running headless under launchd) and compare it against
   the command this instance is about to launch (`_svsup_cmdline_matches_command`,
   `scripts/lib/serve-supervised-lib.sh`). This is a substring match, not an
   exact one — the process actually holding the port is usually a
   *descendant* of the top-level command (`tsx --watch`'s real listener,
   `next dev`'s render worker), so its argv is never literally identical.
   The command's own interpreter/binary always counts as a candidate match;
   later arguments only count if they're long enough and not a bare flag, so
   this doesn't rubber-stamp a match on something as generic as `-w`.
3. A match is killed (`_svsup_reclaim_port`) and the port is awaited free
   before spawning. A non-match is refused — nothing is killed, a loud line
   names the pid and its command line, and the supervisor exits rather than
   starting a child that would silently lose the race for the port. Killing
   an unrelated process that happens to be listening on the same port would
   be a far worse bug than the one this fixes.

As defense in depth, an `EXIT` trap also kills the child tree on any exit
this script didn't plan for — an unbound variable tripping `set -u`, some
future codepath falling through without reaching one of the three
deliberate exits. It's guarded to never double-kill: it no-ops once
`SHUTTING_DOWN` is set (the signal handler already tore the tree down
itself) and after the normal `--max-restarts` exit (`CHILD_ACTIVE` is
already cleared by then). It **cannot** fire on `SIGKILL` — nothing run by
the dying process can — so the pre-spawn reclaim above, not this trap, is
what actually recovers that case.

**Next.js's dev-mode lock is not a separate problem here.** Beyond the port,
`next dev` (when `experimental.lockDistDir` is on, as develemit-hq's config
has it) also holds an OS-level advisory lock at `.next/dev/lock`
(`DevServerInfo`/`Lockfile` in Next's `build/lockfile.js`), used to produce
the "Another next dev server is already running" error. That lock is
acquired by, and tied to a file descriptor owned by, the exact same process
that binds the dev server port — Next's `startWatcher()` stores
`pid: process.pid` in the lock and calls `Lockfile.acquireWithRetriesOrExit`
in-process, not in a forked worker. Advisory (`flock`-style) locks are
released by the kernel the instant the holding process's file descriptors
close, on any termination including `SIGKILL` — so reclaiming the port (which
kills that same process) always releases the lock in the same instant. No
separate lock-file handling was needed.

## Death records

Each death appends one JSON line to `<dir>/.server-deaths.jsonl`, same
JSONL-append convention as `.deploy-history.jsonl`:

```jsonc
{
  "ts": "2026-08-26T21:05:12Z",
  "name": "emit-infra-api",
  "reason": "health-timeout",   // or "exited" or "signalled"
  "exitCode": 143,
  "signal": "15",
  "uptimeSec": 812,
  "restartCount": 2,
  "pid": 50385,
  "host": "studio",
  "lastOutput": "...last ~40 log lines...",
  "signalContext": null
}
```

`reason` distinguishes the three death shapes:

- `health-timeout` — the process (or its watcher) is still running, but the
  health endpoint stopped answering. This is the `tsx --watch` case.
- `exited` — the top-level process the supervisor launched exited on its
  own (no watcher wrapping it, or the watcher itself died).
- `signalled` (sprint 321) — the supervisor itself received `SIGTERM`/`SIGINT`
  and is shutting down on purpose, not restarting. `signal` carries the
  signal name (`"TERM"`/`"INT"`, not the numeric string the other two reasons
  use). `signalContext` is a best-effort snapshot of the sender's parent
  process (`ps -o pid=,ppid=,command= -p $PPID`, captured in the trap handler)
  to help identify who sent it after the fact — `null` when unavailable.
  `uptimeSec`/`pid` are `0`/`null` if the signal arrived before any child had
  spawned yet.

## Log rotation

`~/.local/log/<name>.log` is the live, continuously-mirrored file. Once it
exceeds 5MB, the supervisor copies it into `~/.local/log/<name>/` with a
timestamped name and truncates the live file in place — a copytruncate, not
a rename, so the still-running child (whose fd already points at the old
file) doesn't need to reopen anything. The archive directory is capped at 10
files via `_emit_rotate_logs` (`scripts/lib/ci-log-capture.sh`), the same
helper `.ci-logs`/`.deploy-logs` already use.

## Tests

`scripts/lib/serve-supervised.test.sh`, wired into `pnpm test:hooks`. Notably
reproduces the actual `tsx --watch` failure shape with a fixture that starts
a real HTTP server as a grandchild and kills only that grandchild on a
sentinel — proving watcher-alive/zero-children is detected and restarted,
not just asserted about in the abstract.

SIGINT is asserted via trap registration rather than a live `kill -INT`: bash
sets SIGINT to ignored-by-default for an async (`&`) job launched from a
non-interactive shell, and POSIX forbids a script from overriding a signal
that was already ignored on entry — the same limitation
`scripts/lib/hook-signals.test.sh` documents for its own INT case. SIGTERM
(which exercises the identical handler function) is proven end-to-end
instead.

The pre-spawn reclaim (sprint 325) is covered end-to-end both ways: a real
orphan process pre-bound to the health port with a command line matching
what the supervisor is about to launch gets killed and the new child starts;
one with a non-matching command line is left alone, and the supervisor exits
non-zero with a logged refusal. `_svsup_cmdline_matches_command` itself is
also covered directly against synthetic command lines (matching interpreter,
matching entry-point path, no overlap at all, and a bare short flag alone).
The `EXIT` trap is asserted by sourcing the script without running `main`
(same technique the `start_epoch`/`CHILD_ACTIVE` init test above uses) and
calling `_svsup_handle_exit` directly against a real fixture child+descendant
tree — once with `SHUTTING_DOWN=0` (the tree dies) and once with
`SHUTTING_DOWN=1` (it's left alone, proving no double-kill on a normal stop).

## The watchdog layer: `scripts/dev-stack-watchdog.sh`

`serve-supervised.sh` fixes the process-check blind spot one level down from
launchd; `dev-stack-watchdog.sh` fixes the same blind spot one level up.
Sprint 322.

**Why launchd's `KeepAlive` can't do this.** `com.emit.infra` runs
`caffeinate → pnpm run dev → nx → serve-supervised.sh`, and `KeepAlive`
watches only the top of that chain. When the API supervisor exits on an
external `SIGTERM` (`reason: "signalled"`, sprint 321) it deliberately does
not restart — that's a normal stop, not a crash — but `pnpm dev` and the
Next dashboard keep running happily underneath it. launchd sees a live job
and never restarts anything, even though the API has been unreachable for
hours. The only reliable signal that the stack is actually healthy is that
`http://127.0.0.1:7001/health` answers, which is exactly the argument this
document already makes for `serve-supervised.sh` itself.

**What it does**, on a `StartInterval` timer (120s, via
`com.emit.dev-stack-watchdog.plist`):

1. Probes `--url` (default `http://127.0.0.1:${PORT:-7001}/health`, reusing
   `_svsup_probe_health` from `scripts/lib/serve-supervised-lib.sh`). Success
   resets the consecutive-failure counter and exits — no log line, no action.
2. On failure, increments a counter persisted under
   `~/.local/state/dev-stack-watchdog/`. Before acting on it, checks whether
   launchd actually has `--label` (default `com.emit.infra`) loaded
   (`launchctl print gui/$UID/<label>`). An unloaded job means
   `pnpm launch:stop` ran on purpose — the watchdog clears its counter and
   does nothing rather than fight a deliberate stop.
3. At `--threshold` (default 3) consecutive failures with the job still
   loaded, runs `launchctl kickstart -k gui/$UID/<label>`, logs one line to
   `~/.local/log/dev-stack-watchdog.log`, and resets the counter.
4. Rate-limits recovery to `--ceiling` (default 3) kickstarts per rolling
   hour, tracked in the same state directory. Past the ceiling it logs a
   "give up" line instead of restart-looping a genuinely broken stack.

**Disabling it:** `launchctl bootout gui/$(id -u)/com.emit.dev-stack-watchdog`
unloads the watchdog itself (independent of `pnpm launch:stop`, which only
targets `com.emit.infra`). Delete
`~/Library/LaunchAgents/com.emit.dev-stack-watchdog.plist` to remove it for
good.

**Scope:** local dev only, and only `com.emit.infra` by default — the script
takes `--url`/`--label` so the same binary can later supervise
develemit-hq's `com.develemit.hq`, but wiring that plist is a follow-up.

Tests: `scripts/lib/dev-stack-watchdog.test.sh`, wired into `pnpm test:hooks`.
Stubs `curl` and `launchctl` as shell functions defined before the script is
sourced — the same injection shape `docker-build.test.sh` and
`deploy-plan.test.sh` use for `docker`/`pnpm` — covering: healthy (no
action), below threshold (no action), at threshold (one kickstart), job
unloaded (no action regardless of failure count), and ceiling reached (no
kickstart, one give-up log line).

## The launchd log layer: `scripts/rotate-launchd-logs.sh`

The "Log rotation" section above only covers the file the supervisor mirrors
into (`~/.local/log/<name>.log`). The file launchd itself owns —
`StandardOutPath`/`StandardErrorPath` on the plist — sits one level above
that and has no cap of its own: `com.emit.infra`'s and `com.develemit.hq`'s
launchd logs (`~/.local/log/emit-infra-launchd.log`,
`~/.local/log/develemit-hq-launchd.log`) grow for the life of the agent.
Sprint 324: a stack that spent hours failing produced a 95MB
`develemit-hq-launchd.log`, and the one line that explained the outage was
buried under thousands of Next.js proxy-error lines generated *by* the
outage itself.

`scripts/rotate-launchd-logs.sh` closes that gap by reusing
`_svsup_rotate_log` directly — the same copytruncate helper described above,
called against the launchd-owned files instead of the supervisor-mirrored
ones. Same constraint applies with even higher stakes here: **renaming the
file out from under launchd does not work**. launchd holds the
`StandardOutPath` fd open for the lifetime of the job; a rename leaves it
writing into an unlinked inode forever while the new file at that path stays
empty. Truncate-in-place (`: > "$file"` after copying the tail to an
archive) is the only rotation that a running launchd job survives.

Defaults to the three known unbounded logs (`emit-infra-launchd.log`,
`develemit-hq-launchd.log`, `metrics-collector.log`) at a 5MB cap, 5 archives
kept per log (oldest deleted first), archived into a sibling directory named
after the log (`~/.local/log/<name>/`). Runs hourly via
`com.emit.log-rotate.plist` (`StartInterval`), or by hand with
`--log <path> --max-bytes <n> --max-keep <n>`.

**Disabling it:** `launchctl bootout gui/$(id -u)/com.emit.log-rotate`.
Delete `~/Library/LaunchAgents/com.emit.log-rotate.plist` to remove it for
good.

Tests: `scripts/lib/rotate-launchd-logs.test.sh`, wired into `pnpm test:hooks`
— covers a log over the cap (archived, truncated, inode unchanged so a live
appending writer keeps working), a log under the cap (untouched, no archive
dir created), the archive directory capping at `--max-keep`, and the default
log list.
