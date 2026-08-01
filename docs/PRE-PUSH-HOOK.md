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
`tastease` (`.githooks/`). A project with no symlink gets nothing until someone
runs `emit-infra hooks install` there.

Because the libs are sourced from `$EMIT_INFRA_DIR` at runtime, they propagate
the same way. There is no version pinning: a broken template breaks every
project's push at once, so run the test suite before committing changes here.

## Deploy gates

The deploy phase is skipped, in this order:

1. **Not pushing to `main`** — CI only.
2. **`ci.ghcrOrg` unset** — nothing to push images to.
3. **Dry run** — see below.
4. **Only ignored paths changed** — see below.

`EMIT_FORCE_DEPLOY=1` overrides gates 3 and 4. Use it after an env-only change,
since `.env` files are gitignored and invisible to the path diff.

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
memory. Raise it only on a host with more build memory configured.

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
`EMIT_BUILD_PARALLEL=<n>`, `EMIT_INFRA_DIR=<path>`.
