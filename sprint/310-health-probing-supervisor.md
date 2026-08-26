# Build a health-probing supervisor for long-lived dev servers
**Difficulty:** 4

## Goal
A single reusable supervisor script that keeps a dev server alive by probing
its **health endpoint** (not its process), restarts it with backoff when it
stops answering, records every death as structured JSONL, and mirrors output to
both the terminal and a rotated log file.

## Reason
On 2026-08-23 emit-infra's API was down for ~14 hours and nobody noticed. The
failure shape is nasty: `tsx --watch` **does not restart a child that exits** —
it idles waiting for the next file change. So the supervisor process stayed
alive, held no listening socket, had zero children, and looked perfectly
healthy in `ps`. Verified empirically: throw an uncaught error in a
`tsx --watch` target and you get watcher-alive / zero-children, indefinitely.

This has two consequences that shape the whole design:

1. **A process-existence check is useless here.** Wrapping `tsx --watch` in a
   restart loop does nothing, because tsx never exits. The supervisor must
   probe the port.
2. **The death was unrecorded.** Output went to a raw TTY, so when asked "why
   did it die," there was nothing to read. `~/.develemit/runs/*.log` does not
   capture it.

The user runs these servers in the develemit-hq dashboard's PTY panels so they
can watch output live. That workflow is load-bearing and must survive — this is
why the supervisor runs *in* the terminal rather than being replaced by a
launchd agent (launchd comes later, as an outer layer, in sprint 314).

## Context

### Write it in bash, not TypeScript
This is deliberate. A Node-based supervisor cannot supervise a broken Node
install or a failed module resolution — the supervisor dies with the thing it
is supposed to watch. Bash has no such dependency. It also sidesteps the stale
`apps/cli/dist` trap entirely (a recurring problem in this repo) and lets both
repos invoke it identically without an import.

Follow the existing shell conventions in `scripts/lib/`:
- **bash 3.2.57** (macOS system bash) — no `declare -A`, no `${var^^}`.
- Sourced libs guard with `[[ -n "${_EMIT_X_LOADED:-}" ]] && return 0`.
- `scripts/lib/ci-log-capture.sh` already has a working log-rotation helper
  (`_emit_rotate_logs <dir> [max]`) and documents why a naive
  `exec > >(tee ...)` truncates output on exit — read it before writing the
  tee logic, and reuse rather than reinvent.

### Two traps this repo has already been bitten by
- **SIGPIPE under `pipefail`** (sprint 292): `cmd | grep -q .` kills the
  producer on first match → exit 141 → a `!`-inverted test silently flips.
  Capture into a variable and check separately; never pipe into `grep -q` in
  a conditional.
- **Fixed-timing test assertions** (sprint 303): do not write tests that race
  a wall clock. `scripts/lib/hook-signals.test.sh` has the sentinel-file
  handshake pattern (`_start_fake_phase`, `_wait_phase_ready`, `_wait_until`)
  — reuse those helpers. `docs/TEST-TIMING-PATTERNS.md` records the rules.

### Killing the process tree, not the process
To restart, killing the `tsx --watch` PID is not enough — the actual server is
a **grandchild** (`tsx cli wrapper → watcher → server`). The observed tree was
`27797 → 27811 → 65935`. Kill the group/tree or the old listener may survive
and the restart will hit `EADDRINUSE`.

### Distinguishing a death from an intentional stop
If the user hits Ctrl-C, the supervisor must exit — not "helpfully" restart the
thing they just stopped. Trap `SIGINT`/`SIGTERM`, forward to the child, and
exit without recording a death or restarting.

## Tasks
1. Write `scripts/serve-supervised.sh` taking:
   `--name <slug> --health-url <url> [--dir <path>] [--interval <s>]
   [--failures <n>] [--max-restarts <n>] -- <command...>`
2. Start the command with output mirrored to **both** stdout (so the PTY panel
   still shows it live) and `~/.local/log/<name>.log`.
3. Poll `--health-url` every `--interval` seconds. Treat N consecutive
   failures (`--failures`, default 3) as death — a single blip must not
   trigger a restart.
4. On death: append a record, kill the process **tree**, wait for the port to
   release, restart with exponential backoff (1s, 2s, 4s… capped).
5. After `--max-restarts` consecutive failed starts, stop restarting and print
   a loud, persistent banner explaining what to do. Never spin silently.
6. Trap `SIGINT`/`SIGTERM`: forward to the child, do **not** record a death, do
   **not** restart, exit cleanly.
7. Append death records to `<dir>/.server-deaths.jsonl`, one JSON object per
   line, matching the `.deploy-history.jsonl` convention already used in this
   repo. Fields: `ts` (ISO seconds), `name`, `reason`
   (`health-timeout` | `exited`), `exitCode`, `signal`, `uptimeSec`,
   `restartCount`, `pid`, `host`, `lastOutput` (last ~40 lines, newline-joined).
8. Rotate `~/.local/log/<name>.log` — reuse `_emit_rotate_logs`' approach.
   Nothing in this fleet rotates today; `metrics-collector.log` is already
   7.4 MB.
9. Write `scripts/lib/serve-supervised.test.sh` in the existing style
   (`ok`/`no` assertion helpers, sentinel handshakes — no fixed sleeps).
10. Add the new suite to the `test:hooks` script in root `package.json`.

## Files involved
- new file: `scripts/serve-supervised.sh` — the supervisor
- new file: `scripts/lib/serve-supervised.test.sh` — its test suite
- `scripts/lib/ci-log-capture.sh` — reuse its tee + rotation approach
- `scripts/lib/hook-signals.test.sh` — reuse its sentinel test helpers
- `package.json` — add the new suite to `test:hooks`
- `.gitignore` — ignore `.server-deaths.jsonl`
- `docs/` — a short doc describing the supervisor's contract and flags

## Acceptance criteria
- [ ] A server that exits but leaves its parent watcher alive **is detected**
      and restarted — this is the exact `tsx --watch` case and must be proven
      with a fake target that reproduces watcher-alive/zero-children.
- [ ] A transient single failed probe does **not** cause a restart.
- [ ] Ctrl-C (SIGINT) stops the supervisor and the child, records **no** death,
      and does not restart.
- [ ] Repeated start failures stop at `--max-restarts` with a visible banner
      rather than an infinite loop.
- [ ] Output appears on stdout **and** in `~/.local/log/<name>.log`.
- [ ] Each death appends one valid JSON line to `.server-deaths.jsonl` with all
      required fields; the file stays parseable across many deaths.
- [ ] Log rotation caps the log directory as configured.
- [ ] `scripts/lib/serve-supervised.test.sh` covers every criterion above and
      is wired into `pnpm test:hooks`; all assertions pass.
- [ ] No test asserts against a fixed wall-clock duration
      (`docs/TEST-TIMING-PATTERNS.md`).
- [ ] `bash -n` clean; existing `test:hooks` assertion count does not drop.

## Out of scope
- Changing either app's own code — sprints 311 and 312 wire the two servers up.
- The launchd agent — sprint 314.
- Surfacing deaths in the dashboard — sprint 313.
- Supervising anything other than a long-lived HTTP server (no cron, no
  one-shot scripts).
