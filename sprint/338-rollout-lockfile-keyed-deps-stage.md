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
binaries to an x64 server in tastease build 1247. Both preconditions now hold:
every project keeps the setting in `pnpm-workspace.yaml` (verified 2026-09-17),
and sprint 337 declares probes for the remaining projects.

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
  never `package.json`. Confirmed for all seven on 2026-09-17; re-check each
  repo before converting it.
- The project must declare `ci.imageArchProbes` (sprint 337). Converting a
  project with no probe removes the only safety net for this exact change.

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
- [ ] All 15 images use the lockfile-keyed deps stage, with
      `pnpm-workspace.yaml` copied before `pnpm fetch`
- [ ] pnpm is pinned via `corepack prepare` in every converted Dockerfile,
      matching that repo's `packageManager`
- [ ] Raised fetch retries and network concurrency are present in every one
- [ ] Every converted image builds for `linux/amd64` **and** passes its arch
      probes — quote one probe result per project
- [ ] A script-only edit to a root `package.json` no longer invalidates the
      dependency layer — demonstrate on one project with a cached rebuild
- [ ] Before/after build timings recorded per project
- [ ] No project is deployed by this sprint, and the report says so
- [ ] Each repo's own check command is run, with an empty affected result
      reported honestly rather than as a pass

## Out of scope
- A shared deps *image* across the three images of one repo (the bigger
  dedupe win) — replan that once these numbers land.
- Deploying any project.
- emit-billing and tastease, which already use this pattern.
