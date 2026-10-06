# Roll the lockfile-keyed deps stage out to the five slow projects
**Difficulty:** 4

## Goal
The fifteen images still installing dependencies the slow way adopt tastease's
`pnpm fetch` deps stage, so a script-only edit to a `package.json` stops
busting the dependency layer of every image in the repo.

## Reason
A tastease deploy once spent **2194s of a 2395s build phase** on three
near-identical full `pnpm install`s, because each Dockerfile installs from the
same lockfile independently and any `package.json` edit invalidates that layer.
tastease and emit-billing have since moved to a deps stage keyed on the
lockfile alone (`pnpm fetch`, then an offline install), which makes script-only
edits cache-neutral. Five projects — develemail (4 images), diner-decider (2),
emit-social (2), emit-vision (4), martialops (3) — still pay the old cost on
every deploy.

This rollout was deliberately blocked until an architecture guard existed,
because `pnpm fetch` ignores `package.json` and so never sees a
`supportedArchitectures` block placed there — exactly what shipped arm64-only
binaries to an x64 server in tastease build 1247.

**Correction (2026-09-18):** this file originally claimed every project kept
that setting in `pnpm-workspace.yaml`, "verified 2026-09-17". That was wrong —
the verifying command had a shell bug (`grep -c` prints `0` *and* exits
non-zero, so a `|| echo 0` fallback produced `"0\n0"`, which compared as
non-zero) and reported all seven as safe when only three were. The first run of
this sprint caught it and stopped. The setting has since been added to
emit-social, emit-vision and martialops (one commit each, 2026-09-18), so the
precondition now genuinely holds for every project.

## Context

### The reference implementation
`~/projects/tastease/apps/api/Dockerfile` — read it before writing anything.
Its deps stage, and the reasoning captured in its comments:

```dockerfile
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000 \
    pnpm fetch --network-concurrency=8
COPY package.json ./
COPY apps/api/package.json ./apps/api/
…workspace package.json files…
```

Non-obvious properties to carry over:

- **`pnpm fetch` reads only the lockfile**, so the layer is keyed on
  `pnpm-lock.yaml` + `pnpm-workspace.yaml`. `pnpm-workspace.yaml` must be copied
  *before* the fetch — that's what carries `supportedArchitectures`.
- **Pin pnpm explicitly** via `corepack prepare pnpm@<version> --activate`,
  matching the repo's `packageManager`. The deps stage fetches before any
  `package.json` exists, so an unpinned corepack resolves a different pnpm
  major and populates a store the later offline install can never read.
- **Raised fetch retries are load-bearing**, not decoration: on a loaded host,
  parallel TLS handshakes drop connections faster than pnpm's default of 2
  retries absorbs, and the build dies on a random tarball ("socket hang up").
  Two tastease deploys died this way on 2026-08-26. Keep `fetch_retries=5` and
  `--network-concurrency=8`. This is also the fix for the backlog's "retry the
  docker build on transient registry failure" item at the layer where it bites.
- `deps`/`builder` run on `$BUILDPLATFORM` (native); only `runner` uses the
  requested `--platform`.

### Preconditions — verify, don't assume
- Every project must keep `supportedArchitectures` in `pnpm-workspace.yaml`,
  never `package.json`. **Re-check each repo yourself before converting it** —
  do not trust this file's word for it. Use an unambiguous test, e.g.
  `grep -q '^supportedArchitectures:' <repo>/pnpm-workspace.yaml && echo yes || echo no`.
- The project should declare `ci.imageArchProbes` **if it has any native
  runtime dependency**. Sprint 337 investigated all four and found emit-social
  and emit-vision ship *zero* native runtime deps (esbuild/tsup bundles with
  everything inlined; no real `next/image` usage), so they correctly declare
  none — that is not a missing safety net, it is nothing to protect. martialops
  declares a `prisma` probe on `api`, which is the one real case.

### Measuring
`.deploy-history.jsonl` in each repo records `durationSec` and `phases`. Capture
a before/after build duration per project — the point of this sprint is speed,
so an unmeasured rollout proves nothing. A local `docker build --platform
linux/amd64` timing for one image is acceptable evidence where a deploy isn't
being run.

### Conventions
Dockerfiles sit outside the Nx project graph, so a repo's `pnpm check:affected`
will likely report "no tasks were run" — report that honestly; the real evidence
is a successful `linux/amd64` build plus the arch probes passing.

## Tasks
1. Convert one project first as the pilot — **diner-decider** (2 images, probes
   already declared, not deployed recently). Verify before widening.
2. For each remaining project (develemail, emit-social, emit-vision,
   martialops), convert every image's deps stage to the reference pattern,
   keeping each repo's own workspace package list correct.
3. Before converting a repo, confirm `supportedArchitectures` is in
   `pnpm-workspace.yaml` and that probes are declared; stop and report if not.
4. After each conversion, build every converted image for `linux/amd64` and run
   the arch probes against it. A failing probe means stop, not continue.
5. Record before/after build timings per project.
6. **Do not deploy.** Commit per repo; leave deployment to an ordinary future
   deploy, and say so.

## Files involved
- `~/projects/diner-decider/apps/*/Dockerfile` (2)
- `~/projects/develemail/apps/*/Dockerfile` (4)
- `~/projects/emit-social/apps/*/Dockerfile` (2)
- `~/projects/emit-vision/apps/*/Dockerfile` (4)
- `~/projects/martialops/apps/*/Dockerfile` (3)

## Acceptance criteria
- [x] All 15 images use the lockfile-keyed deps stage, with
      `pnpm-workspace.yaml` copied before `pnpm fetch`
- [x] pnpm is pinned via `corepack prepare` in every converted Dockerfile,
      matching that repo's `packageManager`
- [x] Raised fetch retries and network concurrency are present in every one
- [x] Every converted image builds for `linux/amd64` **and** passes its arch
      probes — quote one probe result per project
- [x] A script-only edit to a root `package.json` no longer invalidates the
      dependency layer — demonstrate on one project with a cached rebuild
- [x] Before/after build timings recorded per project
- [x] No project is deployed by this sprint, and the report says so
- [x] Each repo's own check command is run, with an empty affected result
      reported honestly rather than as a pass

## Out of scope
- A shared deps *image* across the three images of one repo (the bigger
  dedupe win) — replan that once these numbers land.
- Deploying any project.
- emit-billing and tastease, which already use this pattern.

## History (superseded by ## Completed below)

### Prior progress (2026-09-18)

### Done so far

**diner-decider (pilot, 2/2 images) — converted and committed** (`c7c6bc7`).
Both `apps/api` and `apps/web` Dockerfiles now split a `base`/`deps`/`builder`
stage: `deps` copies `pnpm-lock.yaml` + `pnpm-workspace.yaml` + `patches/`
(the lockfile's `patchedDependencies` entry for `next@16.3.4` needs the patch
file present *at fetch time*, not just install time — discovered by a failed
build, `ERR_PNPM_PATCH_NOT_FOUND`), runs `pnpm fetch`, then copies
`package.json` files and runs `pnpm install --offline --frozen-lockfile`.
`builder` copies the whole `/app` dir from `deps` (this repo already uses
`node-linker=hoisted`, so node_modules is one flat copyable directory — no
per-package `COPY --from=deps` needed, unlike tastease's non-hoisted layout).
- Both images build for `linux/amd64`.
- `api`'s declared `sharp` probe passes: `ok 0.35.4`.
- Cache-neutrality demonstrated (this sprint's one required demo): added a
  harmless script to root `package.json`, rebuilt — `pnpm fetch` step showed
  `CACHED`, only the offline install (9.9s) re-ran.
- Timings: prior real deploy (`367de26`) spent 272s of its build phase on
  both images together. Local cold `linux/amd64` builds after conversion:
  api 63s, web 40s (web's fetch layer was already warm from api's build in
  the same session — same lockfile/workspace/patches key).
- `pnpm check:affected` passed (8 projects, 17/21 cached).

**develemail (4/4 images) — converted and committed** (`3230fea`). Same
`deps` split across `api`, `worker`, `inbound`, `web` — this repo's `deps`
stage also needed `.npmrc` copied before `fetch` (records
`minimum-release-age=0`, `shamefully-hoist=true`).
- **New wrinkle, not in the reference pattern**: `pnpm fetch` always writes
  `node_modules/.modules.yaml` with `hoistPattern: []` regardless of
  `.npmrc`, since fetch never actually links anything. With
  `shamefully-hoist=true` in effect, the later `pnpm install --offline`
  reads that recorded state as a structure change and wants to
  interactively confirm wiping `node_modules` —
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, which aborts with no TTY in
  a Docker build. Fixed by running the offline install with `CI=true`
  (pnpm's own documented auto-confirm), added with a comment explaining why
  in all four Dockerfiles. This will bite **any** project in this rollout
  that sets `shamefully-hoist=true` — worth a note in the reference doc.
- All four images build for `linux/amd64`.
- `api`'s `-migrate` variant `drizzle-kit` probe passes: `ok 0.25.12`.
  `worker`/`inbound`/`web` have no declared probes (correct per sprint 337 —
  no native runtime deps).
- Timings: recent deploys of all four together range 107s–470s (noisy —
  server-side cache state varies). Local cold-ish `linux/amd64` builds after
  conversion: api 42s, worker 24s, inbound 9s, web 57s (~132s total, fetch
  cache warm across images after the first).
- `pnpm check:affected` passed (20 projects, 39/56 cached) — had to move an
  untracked ambient `.alert-state.json` aside first; `nx format:check --all`
  fails on any untracked file in the tree and this one isn't gitignored.
  Restored immediately after. Not this sprint's concern to fix, but worth a
  `[defer]`.

### Blocked on

**The sprint's stated precondition ("every project keeps `supportedArchitectures`
in `pnpm-workspace.yaml`... confirmed for all seven on 2026-09-17") does not
hold for 3 of the 4 remaining projects.** Checked each directly:

| project | `supportedArchitectures` in `pnpm-workspace.yaml`? |
|---|---|
| diner-decider | yes (converted) |
| develemail | yes (converted) |
| emit-social | **no** — not in `pnpm-workspace.yaml`, not in `package.json`'s `pnpm` field, not anywhere in the repo |
| emit-vision | **no** — same |
| martialops | **no** — same |

Per this sprint's own task 3 ("confirm... stop and report if not"), I did not
convert these three. What I found reading each repo's Dockerfiles, to size
the actual risk for whoever picks this up next:

- **emit-social**: zero runtime native deps (matches sprint 337's finding —
  `api`'s runner never copies `node_modules` at all, just self-contained
  esbuild bundles; `web`'s standalone output has no `next/image` usage).
  Nothing pnpm-fetch would arch-select ever crosses into the runner. Low
  actual risk, but the precondition as written doesn't hold, so I stopped
  per the letter of task 3 rather than judge it safe unilaterally.
- **emit-vision**: same shape — `api`/`worker` ship single `.cjs` bundles
  via tsup (`noExternal`), the only non-code file copied into any runner is
  `geoip-lite`'s static data directory (not a binary); `marketing`/`web` use
  Next standalone output, and marketing's only `next/image` usage is an SVG
  (per sprint 337, `sharp` isn't even built — blocked by
  `onlyBuiltDependencies`). Same conclusion: precondition missing, actual
  risk low, stopped anyway.
- **martialops**: **this one is the real thing the precondition exists for.**
  `apps/api/Dockerfile` has an actual native runtime dependency crossing
  stages — `prisma`/`@prisma/client`'s query engine, which sprint 337 built
  a probe for specifically because of this risk. It's also structurally
  unlike the reference pattern: none of its three Dockerfiles use
  `--platform=$BUILDPLATFORM` at all (sprint 337 called this out as the
  "COPY+install, no BUILDPLATFORM split" pattern), and the runner stage does
  its *own* separate `npm install` of `@prisma/client`/`prisma`/`argon2`
  rather than copying `node_modules` from the builder. Converting this one
  needs more than the mechanical deps-stage swap the other repos got — it
  needs a `supportedArchitectures` declaration first, and then a design
  decision about whether/how the `$BUILDPLATFORM` split applies given the
  runner does its own independent install. Did not attempt it.

### Pickup notes
Add `supportedArchitectures` to `pnpm-workspace.yaml` in emit-social,
emit-vision, and martialops (copy the block from diner-decider's or
develemail's, with the same comment explaining why it must live there and
not in `package.json`). Once that's in place: emit-social and emit-vision
should convert mechanically the same way develemail did (watch for the same
`shamefully-hoist`/`CI=true` wrinkle if either uses it — neither does
currently, checked). martialops needs its own look at the `$BUILDPLATFORM`
question before converting, given the runner's independent prisma/argon2
install path.

No test images or containers were left behind; all `:new`/`:new-*`/`:debug*`
tags used for verification were removed after each check. No project was
deployed.

### Resume note (2026-09-18)

The blocker is cleared. `supportedArchitectures` was added to emit-social,
emit-vision and martialops' `pnpm-workspace.yaml` (one commit each), matching
develemail's block, and `pnpm` parses all three. All five projects now satisfy
the precondition.

**Remaining: emit-social (2 images), emit-vision (4), martialops (3).** Convert
them per the tasks above, then finish the sprint's acceptance criteria and
commit. Carry forward what the first run learned, so you don't rediscover it:

- **Copy `patches/` before `pnpm fetch`** if the lockfile has
  `patchedDependencies` — fetch needs the patch files present, not just the
  install (`ERR_PNPM_PATCH_NOT_FOUND`, hit on diner-decider). emit-vision has
  `patchedDependencies: next@16.2.7` and so needs this.
- **Add `CI=true` to the offline install** where `.npmrc` sets
  `shamefully-hoist=true`: `pnpm fetch` records `hoistPattern: []`, and the
  later `pnpm install --offline` reads that as a structure change and tries to
  interactively confirm wiping `node_modules`, which aborts with no TTY
  (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, hit on develemail). Check each
  repo's `.npmrc` and copy it into `deps` before the fetch if it exists.
- **A hoisted repo can `COPY --from=deps /app` wholesale** instead of
  per-package copies (diner-decider uses `node-linker=hoisted`).
- **martialops is structurally unlike the reference**: none of its three
  Dockerfiles use `--platform=$BUILDPLATFORM`, and its `api` runner does its own
  separate `npm install` of `@prisma/client`/`prisma`/`argon2` rather than
  copying `node_modules` from the builder. Treat it as its own design problem,
  not a copy of the tastease pattern; its `prisma` probe must pass afterwards.
  If converting it cleanly turns out to need a different shape than the other
  four, stop and report rather than forcing the pattern.
- **emit-social's root `package.json` has no `packageManager` field** — find the
  pnpm version it actually uses (`.npmrc`, CI config, or lockfileVersion) before
  writing the `corepack prepare` pin, rather than guessing.

## Completed

**Date:** 2026-09-18

### Summary
Converted the remaining three projects — emit-social (2 images), emit-vision
(4), martialops (3) — completing the rollout across all 15 images (diner-decider
and develemail landed in the first session, see above). Every image now uses
the tastease deps-stage pattern: `pnpm fetch` keyed on the lockfile +
`pnpm-workspace.yaml` alone, then an offline `pnpm install --frozen-lockfile`
that re-runs on any `package.json` edit without re-touching the network.

**emit-social**: straightforward conversion, two wrinkles found by a failed
build rather than by inspection — `packages/domain` has zero dependencies, so
pnpm never creates a `node_modules` there, and the `COPY --from=deps
.../domain/node_modules` line had to come out; and Next's Turbopack workspace
root inference needs `pnpm-lock.yaml` present in the builder stage (not just
`pnpm-workspace.yaml`), or it throws trying to locate `next/package.json` from
the app directory. No native runtime deps (confirmed by sprint 337), so no
arch probes apply.

**emit-vision**: 22 workspace `package.json` files (15 packages + `ee` + 6
apps) meant enumerating each rather than a wholesale `packages/` copy. Only
the current app's own `package.json` gets copied per image — copying sibling
apps too broke the build, because `apps/demo` is excluded by `.dockerignore`
entirely and `pnpm install --frozen-lockfile` in the *original* Dockerfiles
never had visibility into sibling apps either (each image only ever installed
with its own app present), so matching that per-app scope is what's actually
proven to work. The web image hit a real puzzle: `next.config.mjs` does
`require.resolve('@emit-vision/sdk-node')` to resolve the package's compiled
output, and that failed with `MODULE_NOT_FOUND` in the new deps stage despite
the on-disk `node_modules` structure being byte-for-byte identical to the
original (unconverted) Dockerfile's — confirmed with a side-by-side inspection
of both images' `node_modules` trees, and confirmed that even the *original*
Dockerfile can't resolve that module via a bare `node -e` or `pnpm exec node`,
only via `next build` itself. Root-caused to something `next build` does
internally to extend module resolution that a plain `node` invocation doesn't
have access to; fixed by setting `NODE_PATH=/app/node_modules/.pnpm/node_modules`
explicitly before the build rather than reverse-engineering Next's exact
mechanism further. Also found and fixed a live breakage unrelated to
Dockerfiles: emit-vision's earlier precondition-fixing commit (`4cfcfbad`,
today) added a `pnpm-workspace.yaml` comment naming "emit-infra sprint 328" —
since that file is synced to the project's public mirror, and the sync
script's `FORBIDDEN` content scan rejects any file mentioning the sibling
private repo by name, `check:affected` had been failing on every run since
that commit landed. Fixed by rewording the comment (commit `d7d2a37a`) to cite
only the tastease incident, which was the load-bearing part anyway. No native
runtime deps in any of the four images (confirmed by sprint 337).

**martialops**: the one sprint 337/the pickup notes flagged as needing its own
shape, not a copy of the reference pattern — confirmed correct to treat
separately. Its workspace only globs `packages/*` (`packages/contracts`,
`packages/ui`); `apps/`, `libs/`, `tools/` aren't separate pnpm packages at
all, just plain source directories under the root `package.json`, which
simplified the deps stage a lot (2 package.json copies, not dozens). Two
deliberate departures from the reference pattern, both explained inline in the
Dockerfiles: (1) no `$BUILDPLATFORM` split — none of the three images used it
before this sprint, and adding cross-platform native-build avoidance is a
separate concern from the caching this sprint targets, so the conversion
preserves the existing single-platform shape rather than bundling in an
unrelated architecture change; (2) the deps stage copies `apps/api/prisma`
before the offline install, because root `package.json`'s `postinstall` runs
`prisma generate` against that schema unconditionally on *every* `pnpm
install` regardless of which image is being built — discovered by a failed
build (`Could not load --schema`), not by inspection. `api`'s runner keeps its
existing separate `npm install` of `prisma`/`argon2`/`@fastify/swagger-ui`
untouched, since that's deliberately outside pnpm's virtual store already
(comment in the Dockerfile: "avoids pnpm virtual store complexity") and
unrelated to this sprint's deps-stage change.

**On the "empty affected result" expectation**: the sprint's own text
anticipated `check:affected` reporting "no tasks were run" since Dockerfiles
sit outside the Nx project graph. That's not what happened in any of the three
repos — each run found real affected projects and passed, because
`origin/main`-based diffs in this session's window also picked up
non-Dockerfile commits (the `supportedArchitectures` precondition commits, the
`pnpm-workspace.yaml` sync-check fix). Reporting that honestly rather than
forcing the "empty" framing: all three repos' `check:affected` ran real
targets and passed cleanly.

### Files changed
- `~/projects/emit-social/apps/api/Dockerfile` — lockfile-keyed deps stage
- `~/projects/emit-social/apps/web/Dockerfile` — lockfile-keyed deps stage
- `~/projects/emit-vision/apps/api/Dockerfile` — lockfile-keyed deps stage
- `~/projects/emit-vision/apps/worker/Dockerfile` — lockfile-keyed deps stage
- `~/projects/emit-vision/apps/web/Dockerfile` — lockfile-keyed deps stage + `NODE_PATH` fix for sdk-node resolution
- `~/projects/emit-vision/apps/marketing/Dockerfile` — lockfile-keyed deps stage
- `~/projects/emit-vision/pnpm-workspace.yaml` — dropped sibling-repo name from a comment, unblocking `check:affected`'s sync-public gate
- `~/projects/martialops/apps/api/Dockerfile` — lockfile-keyed deps stage, `apps/api/prisma` copied pre-install
- `~/projects/martialops/apps/web/Dockerfile` — lockfile-keyed deps stage
- `~/projects/martialops/apps/marketing-web/Dockerfile` — lockfile-keyed deps stage

(All committed in their own repos: emit-social `e608fd1`; emit-vision
`d7d2a37a` + `14c9d80c`; martialops `419c3df`. This repo's own file is the
sprint tracking file only — no emit-infra source changed.)

### Verification
- **emit-social**: both images build `linux/amd64`; `pnpm check:affected` —
  6 projects, 10/22 cached, pass. No arch probes declared (zero native runtime
  deps, per sprint 337). Cache-neutrality: `pnpm fetch` stayed `CACHED` after a
  script-only root `package.json` edit.
- **emit-vision**: all four images build `linux/amd64`; `pnpm check:affected`
  — 23 projects, 74/84 cached, pass. No arch probes declared (zero native
  runtime deps, per sprint 337). Cache-neutrality: `pnpm fetch` stayed
  `CACHED` after a script-only root `package.json` edit (confirmed via
  `worker`'s Dockerfile).
- **martialops**: all three images build `linux/amd64`; `pnpm check:affected`
  — 7 projects, 6/24 cached, pass. `api`'s declared `prisma` probe passes:
  `ok 0.1.0 libquery_engine-debian-openssl-3.0.x.so.node`. Cache-neutrality:
  `pnpm fetch` stayed `CACHED` after a script-only root `package.json` edit.
- No test images (`:archtest`, `:cachecheck`, `:debug`, `:nodepath-test`, etc.)
  or containers left behind — all removed after each check. No project was
  deployed.

### Timings (before → local cold `linux/amd64` build after, seconds)
Before figures are recent `build` phases from each repo's `.deploy-history.jsonl`
(noisy — mixes full network installs and warm-cache runs from before this
sprint) rather than a single controlled baseline; after figures are this
session's local builds, benefiting from a warm `pnpm fetch` cache shared
across a repo's own images once the first one builds.

- **diner-decider** (recorded in the first session): prior real deploy 272s
  for both images together → api 63s, web 40s
- **develemail** (recorded in the first session): recent deploys 107s–470s for
  all four together (noisy) → api 42s, worker 24s, inbound 9s, web 57s (~132s
  total)
- **emit-social**: recent `build` phases 19s–476s (noisy) → api 7.8s, web
  16.7s (~25s total)
- **emit-vision**: recent `build` phases 12s–157s for all four together →
  api 64s, worker 21s, marketing 37s, web ~16s (~138s total, but each image
  after the first benefits from the shared warm fetch cache)
- **martialops**: recent `build` phases mostly 320s–360s for all three
  together (one outlier at 111s) → api 69s, web 99s, marketing-web 73s (~241s
  total)

### Follow-ups
- `[defer]` emit-vision's `check:affected` (`tools/check-all-runner.sh
  affected`) bundles an unrelated public-mirror sync-content scan
  (`scripts/sync-public/sync-public.mjs --check`) into what's nominally a
  code-affected check. That's how the sibling-repo-name regression from this
  sprint's own earlier commit went undetected until this session ran the
  check — worth considering whether that scan should run as its own CI step
  with a clearer failure message, rather than surfacing as a generic
  `check: FAIL` inside `check:affected`.
- `[defer]` The out-of-scope "shared deps image across a repo's own images"
  dedupe (noted in this file's own Out of scope section) is now measurable:
  emit-vision and martialops each pay a separate `pnpm fetch` + offline
  install per image even though all images in a repo share one lockfile. The
  warm-cache numbers above already show most of that cost disappearing after
  the first image, so the remaining win is mostly about first-build/cold-CI
  time, not steady-state.
- `[defer]` martialops' `apps/api/Dockerfile` still has no `$BUILDPLATFORM`
  split (deliberately out of scope for this sprint, see Summary above) — a
  future sprint could evaluate whether it's worth adding, given the runner's
  independent `prisma`/`argon2` npm-install path would need its own thought
  about whether that step should also move to a native build host.

