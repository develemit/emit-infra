# The shared pre-push hook

`scripts/hooks/pre-push` runs CI on every push and, when pushing to `main`,
builds images and deploys. It's shared by every emit project — all config comes
from each project's `.emit-infra.json`.

## Files

Milestone 18 split the four files this table used to name into thirteen —
each cluster below still has one entry-point file consumers source (or that
sources the whole hook), so nothing outside this doc needed to change.

### Hook orchestration

| File | Role |
| --- | --- |
| `scripts/hooks/pre-push` | Orchestration: sources every lib below, runs CI then the deploy gates in order |
| `scripts/lib/pre-push-config.sh` | Reads `.emit-infra.json` into the hook's shell scope, resolves the ignored-paths list |
| `scripts/lib/pre-push-ci-phase.sh` | `run_ci` — the self-contained CI phase (its own `ERR` trap, un-trapped on success) |

### Deploy decision (`deploy-plan.sh` cluster)

| File | Role |
| --- | --- |
| `scripts/lib/deploy-plan.sh` | Entry point: sources the three files below, plus `run_build_fanout` and `push_payload_summary` — see [Build fan-out and status integrity](DEPLOY-BUILD-INTERNALS.md#build-fan-out-and-status-integrity) |
| `scripts/lib/deploy-path-filter.sh` | The ignored-paths filter — see [Ignored paths](DEPLOY-GATES.md#ignored-paths) |
| `scripts/lib/deploy-smart-build.sh` | Nx-aware rebuild-vs-retag decision per service — see [Smart build](DEPLOY-BUILD-INTERNALS.md#smart-build) |
| `scripts/lib/deploy-launch.sh` | Last-deployed-sha lookup, dry-run detection, the unattended-shell gate, and the launch-mode declaration — see [Deploy gates](DEPLOY-GATES.md) |
| `scripts/lib/docker-build.sh` | Image naming + buildx invocation |

### Status & history (`ci-utils.sh` cluster)

| File | Role |
| --- | --- |
| `scripts/lib/ci-utils.sh` | Entry point: module state, sources the five files below, plus the six `ci_*`/`deploy_*` writers |
| `scripts/lib/ci-log-capture.sh` | Mirrors stdout/stderr to a log file, rotates old logs |
| `scripts/lib/ci-atomic-write.sh` | Atomic status-file writes, history-file trimming |
| `scripts/lib/ci-phase-tracking.sh` | Per-phase timing for `deploy_done`'s `phases` JSON |
| `scripts/lib/ci-heartbeat.sh` | Writer-liveness heartbeat — see [Liveness fields and staleness](DEPLOY-SIGNALS-AND-LIVENESS.md#liveness-fields-and-staleness) |
| `scripts/lib/ci-signals.sh` | `INT`/`TERM`/`HUP` traps so a killed run doesn't freeze mid-status |

### Detached launch & gate-doctor

| File | Role |
| --- | --- |
| `scripts/deploy-detached.sh` | The supported detached-deploy launcher — see [Detached deploys](DEPLOY-SIGNALS-AND-LIVENESS.md#detached-deploys-the-supported-agent-shell-path) |
| `apps/cli/src/commands/gate-doctor.ts` | `emit-infra gate-doctor` — proves a project's gate is actually runnable, see below |

### Tests

| File | Role |
| --- | --- |
| `scripts/lib/deploy-plan.test.sh` | Tests — decision-logic cluster, `run_build_fanout`, `push_payload_summary` (`bash scripts/lib/deploy-plan.test.sh`) |
| `scripts/lib/deploy-path-filter.test.sh` | Tests — ignored-paths filter, incl. the sprint-292 SIGPIPE regression (`bash scripts/lib/deploy-path-filter.test.sh`) |
| `scripts/lib/docker-build.test.sh` | Tests — image naming + buildx arg construction (`bash scripts/lib/docker-build.test.sh`) |
| `scripts/lib/hook-signals.test.sh` | Tests — signal traps (`bash scripts/lib/hook-signals.test.sh`) |
| `scripts/lib/deploy-liveness.test.sh` | Tests — writer/heartbeat liveness metadata (`bash scripts/lib/deploy-liveness.test.sh`) |
| `scripts/lib/deploy-unattended-gate.test.sh` | Tests — unattended-shell gate + launch-mode declaration (`bash scripts/lib/deploy-unattended-gate.test.sh`) |
| `scripts/lib/deploy-detached.test.sh` | Tests — detached launch, polling, and a real kill-the-launcher survival case (`bash scripts/lib/deploy-detached.test.sh`) |

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
[cross-platform build pattern](CROSS-PLATFORM-BUILD-PATTERN.md) (sprint 268):
CI-only means Docker builds never run, so native conversion buys nothing
today. Revisit once it's provisioned with deploy infrastructure.

Because the libs are sourced from `$EMIT_INFRA_DIR` at runtime, they propagate
the same way. There is no version pinning: a broken template breaks every
project's push at once, so run the test suite before committing changes here.

## What happens on push

1. **CI always runs.**
2. **Pushing to `main`** additionally attempts a deploy, unless one of five
   gates skips or refuses it (dry run, `ci.ghcrOrg` unset, only ignored paths
   changed, an unattended shell) — see [Deploy gates](DEPLOY-GATES.md) for
   each gate's detail and its escape hatch.
3. Each service is rebuilt or re-tagged based on what actually changed since
   the last successful deploy ("smart build"), and on an Apple Silicon build
   host the JS-only stages run natively instead of under emulation — see
   [Build internals](DEPLOY-BUILD-INTERNALS.md) and the
   [cross-platform build pattern](CROSS-PLATFORM-BUILD-PATTERN.md).
4. If the hook (or `emit-infra deploy`) is killed mid-run, signal traps and
   heartbeat metadata record that honestly instead of leaving a stale
   "in progress" status — see [Signals and liveness](DEPLOY-SIGNALS-AND-LIVENESS.md),
   which is also home to the **recovery runbook**: start there if a dashboard
   card or `emit-infra status` shows a run stuck as `orphaned` or `unknown`.

## CI targets must be self-sufficient

`run_ci` injects **no environment** into the targets it runs — it just loops
`pnpm nx affected -t "$target" --base=origin/main` (with `format` special-cased
to `pnpm format`, since `nx affected -t format` matches no projects and
silently no-ops). `ENV_FILE` is sourced only in the deploy phase, after CI,
specifically so tests never run against production values. This is
deliberate; don't change it.

The convention that follows from it: **a declared `ci.prePush` target must
pass on its own**, using only what the target itself provides — not an env
var the caller's shell happens to export, and not a container the caller
happened to leave running. A target that depends on either of those gives a
false green on some machines and a false red on others, and the difference
has nothing to do with the code being pushed.

Two reference fixes for the two ways this actually broke:

- **tastease, commit `66f0c25`.** `ci.sh` prefixed `SKIP_ENV_VALIDATION=1`
  onto its build command — a caller-supplied env var the hook never sets.
  102 unpushed commits over 9 days looked green locally and were rejected on
  the first real push. Fix: stop relying on the prefix; make the build
  self-sufficient instead.
- **emit-billing, commit `a6df8f0`.** Its `test` target resolved a live dev
  postgres container that happened to be running whenever someone tested it
  by hand. Fix: make `test` self-sufficient (start what it needs, or mock
  what it doesn't) instead of depending on ambient container state.

Build-time values that a target legitimately needs (API keys baked into a
static build, etc.) go through **`ci.buildArgs`** in `.emit-infra.json`,
applied during the Docker build in the deploy phase — after `ENV_FILE` is
sourced, not during CI. Six of the seven fleet projects already use it.

**`emit-infra gate-doctor`** checks this without requiring a real push: a
static scan flags exactly the tastease shape (an env var prefixed onto a
CI command in `ci.sh`), and an opt-in `--dynamic` run actually executes each
declared target in a scrubbed environment to catch the emit-billing shape
(ambient container state), which no static check can see. See its
`--help` for usage; it does not fix anything it finds — each repo's fix is
its own change.

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
`EMIT_DEPLOY_DETACHED=1` (durability declaration — set automatically by
`scripts/deploy-detached.sh`; deprecated alias `EMIT_ALLOW_UNATTENDED_DEPLOY=1`
still works), `EMIT_BUILD_PARALLEL=<n>`, `EMIT_INFRA_DIR=<path>`.
