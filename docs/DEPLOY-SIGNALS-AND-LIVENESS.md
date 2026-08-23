# Signals and liveness

↩ back to [the shared pre-push hook overview](PRE-PUSH-HOOK.md). Related:
[Deploy gates](DEPLOY-GATES.md).

## Signals and interrupted runs

**Pushing to `main` is a real production deploy**, not a CI-only push: CI
runs, then Docker images build per changed service, then GHCR push, then
`emit-infra deploy`. It's slow — emulated `linux/amd64` builds, sequential by
default (`EMIT_BUILD_PARALLEL` raises the cap) — which makes it tempting to
kick off from somewhere that won't sit and wait.

The rule is **not** "never deploy from an agent shell" — it's **never launch
a deploy directly in a shell whose lifetime is tied to a single tool call;
use the detached path, which survives it.** Running a bare
`git push origin main` straight inside an agent's background shell, a
sandbox that tears down on timeout, or a CI runner with a short step timeout
is still exactly the 2026-08-19 failure mode — the fix is
`scripts/deploy-detached.sh` (or the `/deploy` skill), documented in
[Detached deploys](#detached-deploys-the-supported-agent-shell-path) below,
not avoiding the push altogether. Sprint 282's signal traps and sprint 283's
liveness metadata (below) stop the dashboard and CLI from *lying* about a
killed run still being in progress, but they don't undo a kill that does
happen: the deploy itself is still cut off wherever it was — a partial
build, a partial rollout — and that needs the same operator attention a
`failed` deploy would. The 2026-08-19 incident (written up in
`docs/DEPLOYMENT-PITFALLS.md`) is exactly this: a teardown-prone environment
killed the hook mid-build, back when a direct push was the only option.

If the hook is killed by `SIGINT`, `SIGTERM`, or `SIGHUP`, it traps the
signal, writes `interrupted` (deploy phase) or `failure` (CI phase) to the
status file, and re-raises the signal so the process's own exit code still
shows it was killed. `SIGKILL` can't be trapped at all; that gap is closed by
the liveness metadata below (sprint 283) instead — a reader infers "the
writer is gone" rather than being told directly. See
[Recovery runbook](#recovery-runbook) below for what to do once you land on a
stuck record.

**Escape hatches**, for when you need to deploy without a natural push:

- `EMIT_FORCE_DEPLOY=1` — bypasses the dry-run and ignored-paths gates. Use
  after an env-only change, since `.env` files are gitignored and invisible
  to the path diff.
- `EMIT_DEPLOY_CONFIRM=1` — adds an interactive confirm prompt on `/dev/tty`
  before the deploy phase runs (defaults to *no*).
- `EMIT_DEPLOY_DETACHED=1` — the durability declaration; bypasses the
  [unattended-shell gate](DEPLOY-GATES.md#unattended-shell-gate) by asserting
  the push will survive its launching shell. Set automatically by
  `scripts/deploy-detached.sh` / the `/deploy` skill — write it by hand only
  if you have your own durable launch mechanism. `EMIT_FORCE_DEPLOY` does
  **not** also do this — see that section for why. The deprecated
  `EMIT_ALLOW_UNATTENDED_DEPLOY=1` alias still works (warns to stderr) —
  replace it wherever found.
- `git push --dry-run` — CI only, no deploy phase at all (see
  [`git push --dry-run`](DEPLOY-GATES.md#git-push---dry-run)).

## Detached deploys (the supported agent-shell path)

`scripts/deploy-detached.sh` is the supported way to deploy from a shell that
might not outlive the push — an agent's background shell, a dashboard-driven
session, anything whose lifetime is tied to a single tool call. It backgrounds
the **whole push** (not just the deploy phase — the hook deploys before
`git push` itself returns, so detaching only the deploy phase would let prod
get ahead of `origin/main`) with `nohup`/`disown`, sets the durability
declaration (`EMIT_DEPLOY_DETACHED=1`), and polls for a terminal result.

**Launch:**

```bash
scripts/deploy-detached.sh --dir <project-dir>            # blocks and polls (default)
scripts/deploy-detached.sh --dir <project-dir> --no-wait   # launch and return immediately
```

The `/deploy` skill is a thin wrapper over the same script — use whichever is
convenient. Preflight refuses to launch (prints why, no status write) when the
tree is dirty, `HEAD` isn't `main`, there's nothing to push, a deploy is
already `running` for the project, or the last record is `orphaned` (run
`emit-infra reconcile --write` first in that case).

**The durability declaration.** `EMIT_DEPLOY_DETACHED=1` asserts "this launch
will survive its caller" — the gate cannot verify that claim (see
[Unattended-shell gate](DEPLOY-GATES.md#unattended-shell-gate) for why), so
the responsibility sits with whatever sets the variable.
`scripts/deploy-detached.sh` earns the claim honestly: `nohup bash -c '...' &
disown`. Don't set `EMIT_DEPLOY_DETACHED=1` by hand around a plain `git push`
— that's the declaration without the mechanism, and a killed shell will
still cut the deploy off mid-build exactly like the 2026-08-19 incident.

**Resuming a deploy whose launching session went away.** The push keeps
running on the machine regardless of whether the session that launched it is
still around. To reattach:

```bash
scripts/deploy-detached.sh --dir <project-dir> --watch
```

`--watch` never relaunches — it only reads `.deploy-status.json` for the
in-flight sha and resumes polling. Other ways to check on it without
relaunching or watching:

- **Log path** is predictable: `/tmp/emit-deploy-<project-name>-<shortsha>.log`
  (`tail -f` it directly), with the push's exit code landing in the sibling
  `.rc` file once it finishes.
- **`emit-infra status`**'s "Local pipeline (this machine)" section reads
  `.ci-status.json`/`.deploy-status.json` from `cwd` and prints each file's
  classified `running`/`orphaned`/`unknown`/`idle` state (see
  [Status files and liveness](#status-files-and-liveness) below) before it
  even attempts the SSH health check — this works from any shell, not just
  the one that launched the deploy.
- **`emit-infra reconcile --write`** — reach for this only once
  `classifyRunState` actually says `orphaned` (a same-host pid that's no
  longer running, or a stale cross-host heartbeat), not merely because the
  session that launched it is gone. A detached deploy with no session behind
  it and a live heartbeat is still `running`, correctly.

**Reading the launch-mode field in a post-mortem.** Every deploy record —
in-flight and terminal — carries `"launch":{"mode","marker"}`
(`packages/core/src/deploy-records.ts` / `scripts/lib/ci-utils.sh`'s
`deploy_init`/`deploy_done`, sprint 290). `mode` is one of:

| `launch.mode` | Meaning |
| --- | --- |
| `detached` | Launched via `EMIT_DEPLOY_DETACHED=1` — the durability declaration was made |
| `unattended-override` | Launched via the deprecated `EMIT_ALLOW_UNATTENDED_DEPLOY=1` alias |
| `interactive` | Launched from a shell the gate didn't need to challenge (had a controlling terminal, or no unattended-shell marker was set) |

`marker` names which of `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT`/`CI` was set, if
any. Neither field is currently printed by `emit-infra status` or the
dashboard — read it straight out of `.deploy-status.json` or
`.deploy-history.jsonl`:

```bash
python3 -c "import json;print(json.load(open('.deploy-status.json')).get('launch'))"
```

A `deploying` record with `launch.mode: "detached"` that later shows up
`orphaned` is a real durability-mechanism failure worth its own investigation
(the declaration was made and didn't hold) — different from an `interactive`
record going orphaned, which is ordinary "someone's laptop closed."

## Status files and liveness

Every status value that can appear in `.ci-status.json` / `.deploy-status.json`,
with what writes it:

| File | Status | Meaning | Writer |
| --- | --- | --- | --- |
| `.ci-status.json` | `running` | CI in flight | `ci_init`/`ci_step` (`scripts/lib/ci-utils.sh`) |
| `.ci-status.json` | `success` | CI passed | `ci_done success` |
| `.ci-status.json` | `failure` | CI failed, or was interrupted mid-run (`SIGINT`/`SIGTERM`/`SIGHUP`) | `ci_done failure`, or the sprint 282 signal handler calling it on the hook's behalf |
| `.deploy-status.json` | `deploying` | Deploy in flight | `deploy_init`/`deploy_step` (bash, pre-push hook), or `deployRecordInit` (`packages/core/src/deploy-records.ts`, `emit-infra deploy`) |
| `.deploy-status.json` | `deployed` | Deploy succeeded | `deploy_done deployed` (bash) or `deployRecordDone(..., 'deployed')` (TS) |
| `.deploy-status.json` | `failed` | Deploy failed | `deploy_done failed` (bash) or `deployRecordDone(..., 'failed')` (TS) |
| `.deploy-status.json` | `interrupted` | Deploy was killed by `SIGINT`/`SIGTERM`/`SIGHUP` mid-run | The sprint 282 signal handler, bash only — `emit-infra deploy`'s TS path has no signal trap |
| `.deploy-status.json` | `orphaned` | A deploy or CI record died with no terminal write at all (typically `SIGKILL`, or the machine going away) and was cleared after the fact | `emit-infra reconcile --write` (sprint 286), for either status file |

`running`/`deploying` are the only **in-flight** statuses — anything else is
terminal, meaning nothing is actively writing to that file. `orphaned` is
deliberately its own status, not a reuse of `failed` or `deployed`: neither
honestly describes a run killed mid-flight (images may already be pushed;
the deploy may or may not have applied).

### Liveness fields and staleness

Every in-flight record (`running`/`deploying`) also carries a `writer` block;
terminal records omit it:

```jsonc
"writer": { "pid": 12345, "host": "studio", "heartbeatAt": "2026-08-19T14:03:21Z" }
```

- `pid` / `host` are captured once when the run starts (`$$` and
  `hostname -s` on the bash side; `process.pid` and Node's `os.hostname()` on
  the TS side — these can differ in *form* on a host where the short name and
  `os.hostname()`'s result diverge, which only costs classification precision,
  not correctness; see the cross-host fallback below).
- `heartbeatAt` refreshes every **30 seconds** on the bash side (a background
  refresher started by `_emit_start_heartbeat`, so a long silent build step —
  the emulated-build case this whole mechanism exists for — still proves
  liveness) or is written once at start on the TS side (`emit-infra deploy`
  has no intermediate progress steps to refresh from).

`packages/core/src/deploy-status.ts`'s `classifyRunState` is the **one and
only** place that turns this into a verdict — the API, the CLI, and the
dashboard all call it rather than inventing their own staleness heuristic.
It returns one of four states, in this priority order:

1. Terminal `status` → always `idle`, no liveness check needed.
2. A same-host writer `pid` that's still alive → `running`. This is the
   strongest signal and wins even over a stale heartbeat (a busy build can
   miss a tick without being wrongly flagged).
3. A same-host writer `pid` that's no longer running → `orphaned`, conclusive.
4. Cross-host records, or same-host records where the pid can't be checked →
   fall back to heartbeat age alone: `orphaned` past
   **120 seconds** (4× the 30s refresh interval — two missed ticks would
   already be suspicious; 4× gives scheduling jitter and a slow disk write
   room without flagging a merely-busy build), `running` otherwise.
5. No `writer` block at all (a pre-283 record) → there's no heartbeat to
   judge, only "how long has this claimed to be running." `unknown` if
   younger than **30 minutes**, `orphaned` past that — a real deploy or CI
   run doesn't take that long, so an in-flight record that old with zero
   liveness evidence is treated as orphaned rather than left `unknown`
   forever.

Consumers: `apps/api`'s `ci-status`/`deploy-status` routes add a `runState`
field to their existing response (additive only); `apps/cli`'s
`emit-infra status` prints it for both local status files before attempting
any SSH connection; the dashboard's pipeline card and project list read it to
distinguish a live progress bar from a stalled one (sprint 285).

## Recovery runbook

You've landed here because a dashboard card or `emit-infra status` shows a
deploy or CI run as `orphaned` or `unknown` instead of progressing normally.

1. **Recognize it.** On the dashboard, an orphaned/unknown run renders as a
   stalled card with a stale duration instead of a moving progress bar
   (sprint 285) — "stuck at 66%" becomes "orphaned, no heartbeat for 47m."
   From a shell, `cd` into the project directory and run `emit-infra status`
   (it reads `.ci-status.json`/`.deploy-status.json` from `cwd`, not a `--dir`
   flag) — its "Local pipeline (this machine)" section prints each status
   file's classified state and the reason (sprint 284), before it even
   attempts the SSH health check.
2. **Confirm what actually shipped**, before touching anything:
   - `git rev-parse HEAD` (local) vs `git ls-remote origin refs/heads/main`
     (remote) — if they differ, the push that started this run never landed
     on `origin/main`, so the deploy that follows a push never had a
     legitimate commit to build from either.
   - Whether images reached GHCR:
     `docker manifest inspect ghcr.io/<ci.ghcrOrg>/<service>:<sha>` (the sha
     from the stuck `.deploy-status.json`) — succeeds only if that service's
     build-and-push phase completed.
   - The server itself is the ground truth for what's actually running; a
     stuck local status file says nothing about server state one way or the
     other.
3. **Clear the record.** `emit-infra reconcile --dir <project-dir>` (dry-run
   by default — prints what it would change, touches nothing).
   `emit-infra reconcile --dir <project-dir> --write` applies it. It only
   acts on records `classifyRunState` calls `orphaned`; a live, heartbeating
   record is left untouched no matter how long it's been running. Reconciling
   writes a terminal `orphaned` status plus exactly one history line, so
   `resolve_last_deployed_sha` (the smart-build base-sha lookup in
   `scripts/lib/deploy-launch.sh`) correctly falls through to the last real
   `deployed` sha in history — the stuck record no longer hides it.
4. **Retry**, once you know what actually shipped and the record is clear —
   push again, or re-run whatever triggered the original push, this time
   from an environment that won't tear the process down mid-flight, or via
   `scripts/deploy-detached.sh` if you're not sure the shell will survive.

### Verifying a detached deploy actually landed

Sprint 289's kill-the-launcher test (a scratch repo + bare remote, killing
the launching process mid-push) proves the mechanism survives a kill in
principle. It has not yet been confirmed against a real production deploy —
that confirmation happens naturally, at whatever project's next ordinary
detached deploy, using this checklist:

- [ ] `origin/main` moved to the pushed sha:
      `git ls-remote origin refs/heads/main` matches the local sha that was
      pushed.
- [ ] The terminal `.deploy-status.json` / `.deploy-history.jsonl` record for
      that sha has `status: "deployed"` and `launch.mode: "detached"`.
- [ ] No stray process survives: nothing matching the pushed sha's `nohup`
      wrapper is still running (`ps aux | grep deploy-detached` from the host
      that launched it, if reachable — the process is gone once `.rc` is
      written) and no zombie heartbeat is refreshing a status file that's
      already terminal.
- [ ] The deployed build is healthy: `emit-infra status` (or `/verify-deploy`)
      against the server shows the expected build number and a passing
      health check.
- [ ] Note the actual wall-clock duration
      (`.deploy-history.jsonl`'s `durationSec`) against
      `scripts/deploy-detached.sh`'s default `--timeout 3600` — flag it if a
      real deploy runs anywhere close to that ceiling.
