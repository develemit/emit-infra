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
`tastease`, `emit-social`, `emit-billing` (`.githooks/`). `emit-billing` is
CI-only (`ci.ghcrOrg` unset — it has no deploy infrastructure yet). A project
with no symlink gets nothing until someone runs `emit-infra hooks install`
there. `martialops` is deliberately unwired for now.

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
`EMIT_BUILD_PARALLEL=<n>`, `EMIT_INFRA_DIR=<path>`.
