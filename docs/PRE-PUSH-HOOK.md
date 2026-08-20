# The shared pre-push hook

`scripts/hooks/pre-push` runs CI on every push and, when pushing to `main`,
builds images and deploys. It's shared by every emit project — all config comes
from each project's `.emit-infra.json`.

## Files

| File | Role |
| --- | --- |
| `scripts/hooks/pre-push` | Orchestration: CI, gates, phases |
| `scripts/lib/deploy-plan.sh` | Decision logic (what to deploy, what to rebuild) |
| `scripts/lib/docker-build.sh` | Image naming + buildx invocation |
| `scripts/lib/ci-utils.sh` | Status files, history, per-phase timing |
| `scripts/lib/deploy-plan.test.sh` | Tests — `bash scripts/lib/deploy-plan.test.sh` |
| `scripts/lib/hook-signals.test.sh` | Tests — signal traps (`bash scripts/lib/hook-signals.test.sh`) |
| `scripts/lib/deploy-unattended-gate.test.sh` | Tests — unattended-shell gate (`bash scripts/lib/deploy-unattended-gate.test.sh`) |

## How projects get the hook

`emit-infra hooks install` **symlinks** the shared script into the project's
`.husky/` (or `.githooks/`) directory:

```
develemail/.husky/pre-push -> ../../emit-infra/scripts/hooks/pre-push
```

The hook is not vendored or copied. Editing the template here changes behavior
for every wired project on their next push — **no re-run of `hooks install`,
and nothing to do with `/wire-ci-utils`** (that command wires a project's own
`scripts/ci.sh` / `scripts/deploy.sh`, not this hook).

Currently wired: `develemail`, `emit-vision`, `diner-decider` (`.husky/`), and
`tastease`, `emit-social`, `emit-billing` (`.githooks/`). `emit-billing` is
CI-only (`ci.ghcrOrg` unset — it has no deploy infrastructure yet). A project
with no symlink gets nothing until someone runs `emit-infra hooks install`
there. `martialops` is deliberately unwired for now.

**This is invisible from inside the wired project.** A project's own
`.github/` may hold nothing but skills and prompts, and `ls .git/hooks` shows
only `.sample` files whenever `core.hooksPath` points elsewhere (as it does
here — at `.husky/` or `.githooks/`). Neither absence means "no CD" the way
it would in a project that uses GitHub Actions for deploy. Confirm with:

```bash
git config --get core.hooksPath && \
  ls -l "$(git rev-parse --show-toplevel)/$(git config --get core.hooksPath)"
```

If that prints a `pre-push` symlink resolving into `emit-infra`, this hook —
and everything in this doc — is live for that project.

`emit-billing`'s Dockerfiles are deliberately **not** converted to the
[cross-platform build pattern](#cross-platform-build-pattern) below (sprint
268): CI-only means Docker builds never run, so native conversion buys
nothing today. Revisit once it's provisioned with deploy infrastructure.

Because the libs are sourced from `$EMIT_INFRA_DIR` at runtime, they propagate
the same way. There is no version pinning: a broken template breaks every
project's push at once, so run the test suite before committing changes here.

## Deploy gates

The deploy phase is skipped, in this order:

1. **Not pushing to `main`** — CI only.
2. **`ci.ghcrOrg` unset** — nothing to push images to.
3. **Dry run** — see below.
4. **Only ignored paths changed** — see below.
5. **Unattended shell** — refuses (not skips: exits non-zero) — see below.

`EMIT_FORCE_DEPLOY=1` overrides gates 3 and 4. Use it after an env-only change,
since `.env` files are gitignored and invisible to the path diff. It does
**not** override gate 5 — see [Unattended-shell gate](#unattended-shell-gate)
for why that's deliberate.

### `git push --dry-run`

Git runs pre-push hooks for a dry run and gives the hook **no** way to tell,
via env, argv, or stdin. A dry run therefore used to run CI, log into GHCR, and
build and push images for real.

**Chosen mitigation:** read the invoking `git push` process's argv. The hook is
a child of that process, so `ps -o args=` still shows `--dry-run` / `-n`.
`detect_dry_run_push` walks up to 5 ancestors looking for the `push` command.

Tradeoffs considered:

- **argv inspection (chosen)** — accurate, zero friction on a normal push, and
  covered by an end-to-end test that runs a real `git push --dry-run`. Relies on
  `ps`, so it's POSIX-ish but not universal; if `ps` returns nothing the hook
  proceeds and deploys, preserving today's behavior rather than blocking a
  legitimate push.
- **Confirmation prompt** — reliable, but adds a prompt to every deploy and
  breaks non-interactive pushes. Available opt-in as `EMIT_DEPLOY_CONFIRM=1`
  (prompts on `/dev/tty`, defaults to *no*).
- **Move deploy out of pre-push** (e.g. to a `post-push` or a manual
  `emit-infra deploy`) — the real fix, since pre-push is the wrong lifecycle
  hook for a deploy. Rejected here as out of scope: it changes the deploy
  trigger for every project at once. Worth doing deliberately later.

### Ignored paths

Deploy is skipped when **every** file changed since the last successful deploy
matches an ignore pattern. Any unrecognized path deploys — the filter can only
ever skip, never force.

Defaults (previously there were none, so a sprint-notes commit triggered a full
build + deploy):

```
sprint/**   docs/**   backlog.md   *.md
```

Patterns use git's `glob` pathspec magic, so `*` stops at `/`: `*.md` is
root-level markdown only, while `docs/**` is recursive.

- `ci.deployIgnorePaths` — **replaces** the defaults.
- `ci.deployIgnorePathsExtra` — **appends** to the defaults.

```jsonc
{
  "ci": {
    "deployIgnorePathsExtra": ["design/**", "*.txt"]
  }
}
```

Note the skip leaves the last-deployed sha where it was, so the next real
deploy still picks up the skipped commits.

### Unattended-shell gate

2026-08-19 incident: an emit-social deploy launched from an agent session's
background shell got killed mid-build (`.deploy-status.json` froze at
`deploying` / 66%). See [Signals and interrupted runs](#signals-and-interrupted-runs)
below for what those killed-run status writes look like and how to recover
from one — this gate is the *prevention* half: it stops the deploy from
starting in that kind of shell at all.

**Blocking signal: env markers.** The deploy phase refuses to start (prints
why, exits 1, no status write) when any of `CLAUDECODE`,
`CLAUDE_CODE_ENTRYPOINT`, or `CI` is set in the environment —
`detect_unattended_shell` in `scripts/lib/deploy-plan.sh`, checked against one
clearly-commented marker list (`EMIT_UNATTENDED_SHELL_MARKERS`) so it's easy
to extend as new ephemeral-shell markers are identified.

**Why not detect "no controlling terminal" as the blocking signal instead:**
empirically, inside the exact kind of agent shell that caused the incident,
`-e /dev/tty` is **true** — the device node exists even with no controlling
terminal, so a gate built on it would be a silent no-op. `[ -t 0 ]` is
meaningless here too: git feeds the ref list to every pre-push hook on stdin,
so stdin is never a tty. `has_controlling_terminal` instead actually *opens*
the controlling terminal (`( : < /dev/tty ) 2>/dev/null`), which is the
correct POSIX check — but absence of a controlling terminal is only a
**warning**, not a block, because GUI git clients (VSCode's Source Control
panel, Tower, GitHub Desktop) have no controlling terminal either and
blocking them would break a normal workflow. That warning path prints to
stderr and the deploy proceeds.

**Opt-out:** `EMIT_ALLOW_UNATTENDED_DEPLOY=1 git push` bypasses both the
block and the warning, for legitimate headless use. This is a separate
variable from `EMIT_FORCE_DEPLOY` on purpose — `EMIT_FORCE_DEPLOY` forces a
deploy past the *path* filters (gates 3/4), and conflating it with "I accept
a killable shell" would have silently re-opened this exact incident for
anyone already exporting it for unrelated reasons.

Gate placement in `scripts/hooks/pre-push` is load-bearing: it runs after
every gate that exits 0 (dry-run, ignored-paths) but before `_fail_deploy` is
installed as the `ERR` trap and before `deploy_init` writes the first
in-flight status record. Exiting non-zero after either of those would fire
`deploy_done failed` with the run's start time unset, both writing a status
record this gate promises not to write and throwing a bash arithmetic error.

### Signals and interrupted runs

**Pushing to `main` is a real production deploy**, not a CI-only push: CI
runs, then Docker images build per changed service, then GHCR push, then
`emit-infra deploy`. It's slow — emulated `linux/amd64` builds, sequential by
default (`EMIT_BUILD_PARALLEL` raises the cap) — which makes it tempting to
kick off from somewhere that won't sit and wait. Don't. **Never push to
`main`, or otherwise trigger a deploy, from an environment that can tear the
process down before it finishes** — an agent's background shell, a sandbox
that tears down on timeout, a CI runner with a short step timeout. Sprint
282's signal traps and sprint 283's liveness metadata (below) stop the
dashboard and CLI from *lying* about a killed run still being in progress,
but they don't undo the kill: the deploy itself is still cut off wherever it
was — a partial build, a partial rollout — and that needs the same operator
attention a `failed` deploy would. The 2026-08-19 incident (written up in
`docs/DEPLOYMENT-PITFALLS.md`) is exactly this: a teardown-prone environment
killed the hook mid-build.

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
- `EMIT_ALLOW_UNATTENDED_DEPLOY=1` — bypasses the
  [unattended-shell gate](#unattended-shell-gate) for legitimate headless use.
  `EMIT_FORCE_DEPLOY` does **not** also do this — see that section for why.
- `git push --dry-run` — CI only, no deploy phase at all (see
  [`git push --dry-run`](#git-push---dry-run) above).

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
   `scripts/lib/deploy-plan.sh`) correctly falls through to the last real
   `deployed` sha in history — the stuck record no longer hides it.
4. **Retry**, once you know what actually shipped and the record is clear —
   push again, or re-run whatever triggered the original push, this time
   from an environment that won't tear the process down mid-flight.

## Smart build

Services are split into rebuild vs. re-tag, diffed against the last successful
deploy.

**Finding the base sha.** `.deploy-status.json` holds only the latest run, so
any interrupted deploy leaves it in state `deploying` and hides the last
known-good sha — which meant every service rebuilt from scratch, on every push,
until one deploy finally completed. `resolve_last_deployed_sha` now falls back
to the newest `deployed` entry in `.deploy-history.jsonl`. Only when no
successful deploy exists at all does it return empty and rebuild everything.

**Deciding per service**, in order:

1. No usable base sha → **rebuild** (safe default).
2. An unconditional trigger path changed → **rebuild**. Defaults:
   `pnpm-lock.yaml`, `apps/<svc>/Dockerfile`, `apps/<svc>/infra/`. Extend with
   `ci.buildTriggerPaths`, where `%s` expands to the service name.
3. The service is a resolvable Nx project → **rebuild only if `nx show projects
   --affected --base=<last>` lists it.** This replaced a `packages/` glob that
   rebuilt every service whenever any package changed.
4. Otherwise (non-Nx repo, or a service whose name isn't an Nx project) → the
   original glob: any change under `apps/<svc>/` or `packages/`.

If either nx query *fails*, every service falls back to step 4. An empty
affected list is only trusted when nx actually exited zero — otherwise an nx
error would silently mean "rebuild nothing".

Nx prints a JSON array when stdout isn't a TTY (always, under a git hook) and
newline-separated names when it is; `nx_projects` accepts both.

## Build cache

`ci.buildCache` (default `"inline"`) adds
`--cache-from type=registry,ref=<img>:latest --cache-to type=inline`, so a cold
rebuild reuses layers from the last pushed image. Inline cache is embedded in
the image itself rather than a separate `:buildcache` tag — which matters
because `scripts/ghcr-prune.sh` keeps only `:latest` and versioned tags and
would delete a dedicated cache tag. Set `"off"` to disable.

Parallel builds stay opt-in via `EMIT_BUILD_PARALLEL=<n>` (default `1`): two
concurrent emulated `linux/amd64` Node builds can exhaust the Docker build VM's
memory. Raise it only on a host with more build memory configured. Projects
that have adopted the [cross-platform build pattern](#cross-platform-build-pattern)
below run their `deps`/`builder` stages natively instead of under emulation,
which removes the main source of that memory pressure — `EMIT_BUILD_PARALLEL=2`
ran two concurrent native builds on a 16-core / 7.75GB-VM host without an OOM
in testing (develemail, sprint 255). Still opt-in; the default stays `1` until
more projects have converted and it's been proven safe more broadly.

## Cross-platform build pattern

On an Apple Silicon build host, `docker buildx build --platform linux/amd64`
runs every stage under QEMU emulation by default — expensive for anything
CPU-bound (`pnpm install` postinstall scripts, `nx build`/esbuild bundling,
tsc). Node output itself is architecture-independent, so only the stage that
actually ships needs to resolve to the target platform; everything upstream
of it can run natively on the build host.

**The technique:** pin the stages that only produce JS artifacts to
`$BUILDPLATFORM` (BuildKit resolves this to the host's real platform — e.g.
`linux/arm64` on an Apple Silicon Docker Desktop VM, run natively, no
emulation). Leave the stage that's actually shipped (and any stage — like a
migration runner — that executes compiled output) on a plain `FROM`, which
resolves to whatever `--platform` was requested on the CLI (`linux/amd64` for
the Hetzner fleet):

```dockerfile
# deps/builder only produce arch-independent JS artifacts, so they run
# natively on the build host. runner stays on the requested --platform
# since that's what actually ships.
FROM --platform=$BUILDPLATFORM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app

FROM base AS deps
# ... COPY package.json files, pnpm install --frozen-lockfile ...

FROM base AS builder
# ... COPY --from=deps node_modules, COPY . ., nx build ...

# plain FROM, not `base` — this stage ships and must resolve to the
# requested target platform, not the native build host's.
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist/apps/<svc> ./
CMD ["node", "main.cjs"]
```

Reference implementation: develemail's `apps/api/Dockerfile` (also has a
`migrate` variant target that exercises the native-module case below).

**The native-module trap.** Anything with a platform-specific compiled
binary — `sharp`, `@next/swc-*`, `esbuild`, `@parcel/watcher`, `@swc/core` are
common ones in a Next.js/Nx workspace — gets installed for the *build host's*
architecture in a `$BUILDPLATFORM` stage. If that stage's `node_modules` (or
anything traced from it, like a Next.js standalone output) ends up in the
shipped image, you get arm64 binaries in an amd64 container: a crash at
startup, not a build-time failure. Two sub-cases:

- **Ships to runtime** (e.g. `sharp`, bundled into Next's `.next/standalone`
  output): needs the *target* platform's binary in the stage that gets
  copied forward.
- **Only executes during the build or a build-adjacent step** (e.g.
  `esbuild`/`@swc/core` compiling, or `drizzle-kit` — which depends on
  `esbuild` directly — running in a `migrate` stage that reuses `deps`'
  `node_modules` on the target platform): needs the *build host's* binary to
  run at all, and separately needs the *target* binary wherever that
  `node_modules` gets copied onto a target-platform stage.

Fix with pnpm's `supportedArchitectures` (in the root `package.json`'s `pnpm`
field — not `.npmrc`; pnpm resolves this per-package.json, not as a flat
config key, as of pnpm 10.x):

```jsonc
"pnpm": {
  "supportedArchitectures": {
    "os": ["linux", "darwin", "current"],
    "cpu": ["x64", "arm64"],
    "libc": ["musl", "glibc"]
  }
}
```

This installs both arch's optional platform binaries wherever pnpm resolves
them, so the `$BUILDPLATFORM` stage can execute its own build tools *and*
whatever gets copied into a target-platform stage resolves the correct
binary at runtime (packages like `sharp`/`@next/swc-*` pick their binary via
`process.platform`/`process.arch` at require time, so having both installed
is sufficient — no per-stage filtering needed). `os`/`libc` stay broad
(`darwin` alongside `linux`, `glibc` alongside `musl`) so this doesn't break
local development on macOS.

This is a workspace-wide setting — it applies to every Dockerfile's
`pnpm install`, not just the one that needs it, so services with zero native
runtime dependencies (nothing shipped past a fully-bundled `main.cjs`, no
`migrate`-style stage) pay a small, measurable tax in `pnpm install` and
inter-stage `COPY node_modules` time for binaries they'll never use. Confirm
whether a service actually needs it (grep its shipped output for native
`require`s / check whether any stage reuses `deps`' full `node_modules` on a
different platform than it was installed on) before assuming the workspace
default is free.

**The untaxed path, confirmed in practice (sprint 266):** emit-vision's four
services (`web`, `api`, `worker`, `marketing`) converted with zero
`supportedArchitectures` — a full workspace-wide grep across every
`package.json` (including transitively-copied `packages/*`) turned up no
`sharp`/`@next/swc-*`/`esbuild`/`@parcel/watcher`/`@swc/core`-class package
anywhere in the four services' shipped surface: `api`/`worker` ship a single
`tsup --bundle` `.cjs` with zero `node_modules` in the runner (aside from a
data-only asset directory, not code), and `web`/`marketing`'s Next.js
standalone output traced no native binding either. Result: 200s → 119s
build phase (-40%) with no install tax paid anywhere. Don't reach for
`supportedArchitectures` by default — grep first; plenty of workspaces have
nothing that needs it.

**Both sub-cases confirmed in practice.** diner-decider (sprint 267) hit the
**ships-to-runtime** sub-case: its `api` shipped `sharp` for the R2 photo
pipeline, so the runner stage needed the target platform's `sharp` binary
traced forward from `node_modules`. tastease (sprint 268) hit the
**build-adjacent** sub-case, and it's worth walking through because no prior
sprint (255/266/267) had actually triggered it: `apps/api`'s `migrate` target
was `FROM builder AS migrate` — an empty stage that just inherits `builder`
wholesale. Once `builder` moved to `$BUILDPLATFORM`, `migrate` would have
silently inherited that native platform too (`FROM <alias>` doesn't
re-resolve against the CLI's requested `--platform`). `migrate` runs `npx tsx
packages/db/src/migrate.ts` on the server at container *start*, and `tsx`
shells out to esbuild's native binary at that point — not at build time — so
a native-host `migrate` image would have crashed on the amd64 server with an
exec-format error the first time someone ran a migration, well after the
image had already built and pushed successfully. Fixed by giving `migrate`
its own plain `FROM node:22-alpine` stage (matching develemail's reference
`migrate` pattern) instead of inheriting `builder`, plus
`pnpm.supportedArchitectures` in tastease's root `package.json` so both
platforms' esbuild binaries are available for `tsx` to pick the right one
from at runtime.

**Verify before shipping**, every time this pattern touches a service with
native dependencies: `docker buildx build --platform linux/amd64 ... --load`,
then `docker run --platform linux/amd64 <image>` and confirm it fails (or
succeeds) on something *other* than an exec-format or "wrong ELF class"
error — a missing env var or a refused DB connection is a clean pass; a
native-module crash is not. A real deploy with server-side log verification
is the definitive check.

## Diagnosing slow deploys

Each `.deploy-history.jsonl` entry records per-phase seconds:

```jsonc
{ "durationSec": 431, "servicesBuilt": ["api"],
  "phases": { "ci": 88, "auth": 2, "build": 297, "retag": 4, "deploy": 40 } }
```

```bash
# slowest builds, most recent first
tail -20 .deploy-history.jsonl | python3 -c '
import json,sys
for l in sys.stdin:
    e=json.loads(l); p=e.get("phases",{})
    print(e["sha"][:7], e["durationSec"], p)'
```

`phases` is absent on entries written before 2026-08.

## Config reference

```jsonc
{
  "ci": {
    "deployIgnorePaths":      ["..."],  // replaces defaults
    "deployIgnorePathsExtra": ["..."],  // appends to defaults
    "buildTriggerPaths":      ["deploy/%s.yml"],  // always rebuild <svc>
    "buildCache": "inline"              // "inline" | "off"
  }
}
```

Env overrides: `EMIT_FORCE_DEPLOY=1`, `EMIT_DEPLOY_CONFIRM=1`,
`EMIT_ALLOW_UNATTENDED_DEPLOY=1`, `EMIT_BUILD_PARALLEL=<n>`,
`EMIT_INFRA_DIR=<path>`.
