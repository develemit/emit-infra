# Build internals

↩ back to [the shared pre-push hook overview](PRE-PUSH-HOOK.md). Related:
[Cross-platform build pattern](CROSS-PLATFORM-BUILD-PATTERN.md).

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
that have adopted the [cross-platform build pattern](CROSS-PLATFORM-BUILD-PATTERN.md)
run their `deps`/`builder` stages natively instead of under emulation, which
removes the main source of that memory pressure — `EMIT_BUILD_PARALLEL=2` ran
two concurrent native builds on a 16-core / 7.75GB-VM host without an OOM in
testing (develemail, sprint 255). Still opt-in; the default stays `1` until
more projects have converted and it's been proven safe more broadly.

## Build fan-out and status integrity

`run_build_fanout` (`scripts/lib/deploy-plan.sh`) backgrounds `build_image`
for each service needing a rebuild, batching `max_parallel` at a time
(`EMIT_BUILD_PARALLEL`) and `wait`-ing each batch before starting the next.

**Sprint 270:** the loop used to be `build_image "$svc" & ...; wait "$pid" ||
exit 1`, relying on the `ERR` trap to run `deploy_done failed` on the way
out. It doesn't: `wait`'s failure is consumed by `||`, and the `exit` that
follows doesn't fire `ERR` either — a failed backgrounded build left
`.deploy-status.json` stuck at `deploying` forever. `run_build_fanout` takes
an `on_fail` callback and calls it directly on any failed `wait`, for every
batch, removing the dependency on trap semantics entirely.
`scripts/hooks/pre-push` passes `_fail_deploy` (the same named function
installed as the `ERR` trap) as that callback, so a build failure and a
trapped error both end the run the same way: `deploy_done failed`, then exit
non-zero.

The same sprint added `push_payload_summary` (also in `deploy-plan.sh`):
before the build starts, it prints the commit count and oldest commit's
age/subject for what's about to ship (`git log <remote-sha>..<local-sha>`,
from the refs the hook already reads off stdin) — informational only, no
prompt, no gate. It exists because a month-old local commit once rode along
silently in a routine test push; the summary makes that visible before the
deploy runs, without blocking anyone from proceeding.

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
