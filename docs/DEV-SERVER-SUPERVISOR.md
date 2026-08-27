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

1. Starts `<command...>`, mirroring its output to **both** stdout (so a PTY
   panel still shows it live) and `~/.local/log/<name>.log`.
2. Polls `--health-url` every `--interval` seconds. `--failures` consecutive
   failures counts as death.
3. On death: snapshots the process **tree** and kills all of it (not just the
   top pid — the real listener is often a grandchild), waits for *every* pid
   in that snapshot to go away, escalating to `SIGKILL` for stragglers, then
   waits for the port to release, then restarts with exponential backoff
   (1s, 2s, 4s… capped at 60s).
4. If the port is *still* held after all that, `SIGKILL`s whatever is
   listening on it. A grandchild that reparents to pid 1 mid-teardown keeps
   the socket, and every subsequent start then dies instantly — on
   `EADDRINUSE`, or for `next dev` on "Another next dev server is already
   running" — until something reaps it. Loopback health URLs only.
5. After `--max-restarts` consecutive deaths, stops and prints a persistent
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
5. `Ctrl-C` (`SIGINT`/`SIGTERM`) forwards to the child and exits — this is a
   normal stop, not a death: no restart, no record.

## Death records

Each death appends one JSON line to `<dir>/.server-deaths.jsonl`, same
JSONL-append convention as `.deploy-history.jsonl`:

```jsonc
{
  "ts": "2026-08-26T21:05:12Z",
  "name": "emit-infra-api",
  "reason": "health-timeout",   // or "exited"
  "exitCode": 143,
  "signal": "15",
  "uptimeSec": 812,
  "restartCount": 2,
  "pid": 50385,
  "host": "studio",
  "lastOutput": "...last ~40 log lines..."
}
```

`reason` distinguishes the two death shapes:

- `health-timeout` — the process (or its watcher) is still running, but the
  health endpoint stopped answering. This is the `tsx --watch` case.
- `exited` — the top-level process the supervisor launched exited on its
  own (no watcher wrapping it, or the watcher itself died).

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
