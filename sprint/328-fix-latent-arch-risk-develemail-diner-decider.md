# Close the latent arch risk in develemail and diner-decider
**Difficulty:** 3

## Goal
develemail and diner-decider move `supportedArchitectures` into
`pnpm-workspace.yaml` and declare their native-dependency probes, so neither
breaks when the lockfile-keyed deps stage rolls out — and so the guard actually
covers them.

## Reason
A fleet scan on 2026-09-11 found no project broken in production, but two
projects are one change away from it. Both still keep `supportedArchitectures`
in root `package.json`, which is invisible to `pnpm fetch`:

- **develemail** — `apps/api/Dockerfile:38` has a target-platform `migrate` stage
  that copies `deps`' node_modules (`:40`) and runs `drizzle-kit migrate` (`:43`),
  which depends on esbuild. Setting at `package.json:86-101`. It fails **quietly**:
  `migrate` is a `buildVariants` entry with no `migratePre`, run by hand, so a
  deploy would succeed and the breakage would surface at the next manual
  migration — possibly weeks later, with no obvious link to the deploy.
- **diner-decider** — `apps/api/Dockerfile:34-37` copies `sharp`, `@img`,
  `detect-libc` and `semver` out of the native builder into a target-platform
  runner, and `apps/api/src/server.ts:22,33` import routes that
  `import sharp from 'sharp'` at startup. Setting at `package.json:37-51`. It
  fails **loudly**: the api container crashes on boot and the blue/green health
  check catches it.

This is not hypothetical. Two open items in `backlog.md` — "Dedupe pnpm install
across images" and "Key the deps layer on the lockfile only" — propose rolling
tastease's exact deps-stage pattern across the fleet. Both now carry a warning
annotation (`2143216`), but a warning is weaker than removing the landmine.
Moving the setting costs nothing today and is a no-op for current builds, since
pnpm reads it from either location for a plain `pnpm install`.

diner-decider carries one extra wrinkle worth checking rather than assuming: its
root `package.json` also holds `pnpm.overrides` and `pnpm.patchedDependencies`,
and `patchedDependencies` was moved *into* `package.json` from
`pnpm-workspace.yaml` at some point. Those keys have their own resolution rules
and are **not** in scope to move — only `supportedArchitectures` moves.

## Context

### Repos
`~/projects/develemail` and `~/projects/diner-decider`. Cross-repo sprints are
normal here — `docs/CROSS-PLATFORM-BUILD-PATTERN.md` records sprint 267 fixing
diner-decider and sprint 268 fixing tastease.

### The move itself
Delete the `"pnpm": { "supportedArchitectures": {...} }` block from root
`package.json` and add the equivalent YAML to `pnpm-workspace.yaml`:

```yaml
supportedArchitectures:
  os: [linux, darwin, current]
  cpu: [x64, arm64]
  libc: [musl, glibc]
```

Verified on pnpm 10.30.2 in tastease `c3e0744`: pnpm honours it from
`pnpm-workspace.yaml`, including under the `pnpm fetch` ordering. Add a short
comment in each `pnpm-workspace.yaml` saying why it must live there (a
`package.json`-only setting is invisible to `pnpm fetch`), so nobody moves it
back. Confirm `pnpm install --frozen-lockfile` still passes in each repo — the
setting should not change the lockfile.

**Neither project's Dockerfiles change in this sprint.** They still `COPY
package.json ... && pnpm install` (no `pnpm fetch`), so the move is inert for
today's builds; it only matters when the deps-stage rollout lands. That makes
this a low-risk change with a delayed payoff — say so plainly rather than
claiming a behaviour fix.

### Probes to declare (sprint 326's `ci.imageArchProbes` schema)
- develemail: the `migrate` build variant — probe kind `tsx` won't fit exactly,
  since it runs `drizzle-kit`, not `tsx`. Either reuse the esbuild-loading probe
  or add a `drizzle-kit` kind that invokes `node_modules/.bin/drizzle-kit
  --version` (which loads esbuild). Pick one and say which; do not add a probe
  that merely checks a file exists.
- diner-decider: the `api` image needs `sharp` required **directly**, not via
  next's package dir — its api is Fastify, not Next. Sprint 326's `next-sharp`
  kind resolves through `require.resolve('next/package.json')` and will not work
  here; add a plain `sharp` kind.
- develemail's `web` traces `sharp` through Next standalone but has **no
  next/image imports**, so sharp never loads. Declaring a probe there would fail
  a deploy over something production never executes. Leave it undeclared and note
  why.

### Deploying these projects
Same constraints as every project in the fleet: `git push` is the deploy and the
pre-push hook refuses `$CLAUDECODE` shells, so use `bash
~/projects/emit-infra/scripts/deploy-detached.sh --dir ~/projects/<project>
--no-wait` and read `.deploy-status.json` plus
`/tmp/emit-deploy-<project>-<sha>.log` directly rather than `--watch`.

**Both repos have large unpushed ranges** — measured 2026-09-12: develemail **55**
commits ahead of its deployed `e0949ed`, diner-decider **32** ahead of `367de26`.
Both counts drift, so re-measure with `git rev-list --count <deployed-sha>..HEAD`
rather than trusting these numbers. Deploying either ships the whole range, not
just this sprint's change. Read what is in each range before deploying, and if it
looks like it needs its own review, **stop and report rather than shipping it
blind** — 55 commits is far past the point where a deploy is a routine
side effect of an unrelated sprint. This sprint's change is inert either way
(neither project's Dockerfiles use `pnpm fetch` yet), so leaving a project
undeployed with the fix committed is a perfectly good outcome — prefer it over
shipping a range you have not read.

## Tasks
1. develemail: move `supportedArchitectures` from `package.json:86-101` into
   `pnpm-workspace.yaml` with an explanatory comment; confirm
   `pnpm install --frozen-lockfile` still passes.
2. diner-decider: same from `package.json:37-51`, leaving `pnpm.overrides` and
   `pnpm.patchedDependencies` untouched.
3. Declare `ci.imageArchProbes` in each project's `.emit-infra.json` per the
   notes above, adding the probe kinds sprint 326 lacks (`sharp` direct, and the
   develemail migrate probe).
4. Prove each probe is real: build the relevant image for `linux/amd64` and
   confirm the probe passes; then confirm it *fails* on an image built with the
   setting removed. A probe never seen failing is not evidence.
5. Review each repo's unpushed range; deploy where that is reasonable, and report
   honestly if you leave one undeployed.
6. Update `docs/CROSS-PLATFORM-BUILD-PATTERN.md`'s per-project notes so
   develemail and diner-decider are recorded as using `pnpm-workspace.yaml`.

## Files involved
- `~/projects/develemail/package.json`, `pnpm-workspace.yaml`, `.emit-infra.json`
- `~/projects/diner-decider/package.json`, `pnpm-workspace.yaml`, `.emit-infra.json`
- `scripts/lib/image-arch-check.sh` — new probe kinds (`sharp`, develemail migrate)
- `scripts/lib/image-arch-check.test.sh` — cover the new kinds
- `docs/CROSS-PLATFORM-BUILD-PATTERN.md` — per-project notes

## Acceptance criteria
- [x] Neither repo has `supportedArchitectures` in `package.json`; both have it in
      `pnpm-workspace.yaml` with a comment explaining why
- [x] `pnpm install --frozen-lockfile` passes in both repos with no lockfile change
- [x] diner-decider's `pnpm.overrides` and `pnpm.patchedDependencies` are
      untouched — confirm explicitly in the report
- [x] Each new probe is demonstrated **both ways**: passing on a correctly built
      image, failing on one built without the setting. Quote both.
- [x] develemail's `web` has no sharp probe, with the reason recorded
- [x] Test coverage for the new probe kinds in
      `scripts/lib/image-arch-check.test.sh`
- [x] `pnpm test:hooks` passes in emit-infra; each touched repo's own check
      command passes
- [x] Deploy state of both projects is stated plainly — deployed and verified, or
      committed and deliberately not deployed, with the reason

## Out of scope
- Adopting `pnpm fetch` / the lockfile-keyed deps stage in either project. That
  is the backlog rollout this sprint is making safe; doing both at once would
  confound the two changes.
- Changing any Dockerfile in either repo.
- The other eight projects the scan classified SAFE. Note that emit-social,
  emit-vision and math-problemizer likely ship arm64-only `sharp` via Next
  standalone and are harmless only because none uses a raster `next/image` —
  worth a follow-up item, not work here.

## Completed

**Date:** 2026-09-12

### Summary
develemail and diner-decider both moved `supportedArchitectures` out of root
`package.json` and into `pnpm-workspace.yaml` (with a comment explaining why,
matching tastease's pattern), closing the latent arch risk before the
lockfile-keyed deps-stage rollout in `backlog.md` lands. Neither Dockerfile
changed, and neither project's `pnpm install --frozen-lockfile` touched its
lockfile — the move is a no-op for today's builds, as designed.

Both new `ci.imageArchProbes` kinds needed real investigation, not just the
sprint's suggested shapes, because both suggestions turned out not to
reproduce the failure:

- **`sharp` (diner-decider)** works as suggested: diner-decider's `api` is
  Fastify, not Next, and imports `sharp` directly at startup
  (`domains/uploads`, `domains/places-photos`). A plain `require('sharp')`
  from the app root (WORKDIR `/app` in the runner) is the correct probe — no
  `createRequire` indirection needed since sharp isn't buried in another
  package's dir.
- **`drizzle-kit` (develemail) — the sprint's suggested `--version` invocation
  does not exercise esbuild.** Verified directly: ran `drizzle-kit --version`
  against a migrate image built with the platform's native esbuild binary
  physically removed, and it printed a clean version string anyway — esbuild
  is only touched when drizzle-kit transpiles a TS config file
  (`drizzle.config.ts`), which needs `drizzle-kit migrate` reaching that step,
  which itself needs a database to fail past cleanly and produces messy,
  non-deterministic output (a stuck connection spinner) unsuitable as a
  probe. Instead the `drizzle-kit` probe resolves the exact esbuild instance
  `drizzle-kit` depends on (`createRequire(require.resolve('drizzle-kit'))('esbuild')`)
  and calls `transformSync` directly — the same native binary invocation
  `migrate` would eventually make, without needing a database. This is worth
  flagging because the sprint file's own suggestion, if implemented literally,
  would have shipped a probe that always passes.

develemail's `web` was confirmed to need no sharp probe: no `next/image`
imports anywhere in `apps/web`, and no other develemail app imports `sharp`.

**A real, unrelated, active bug was found and left unfixed (out of scope):**
building diner-decider's actual `apps/api/Dockerfile` at HEAD fails —
`RUN pnpm nx run api:build` errors with `Cannot find module
'@diner-decider/quota-limits'` / `'@diner-decider/db-test-guard'`. The
Dockerfile's `COPY` list was never updated for `packages/quota-limits` and
`packages/db-test-guard` (added in sprint 88, "Give web and api one shared
source for the quota limits"), part of diner-decider's 32-commit unpushed
range. `nx run api:build` succeeds fine outside Docker (all packages present
on disk), so nothing local caught this. To validate the `sharp` probe against
a real production-shaped image, a temporary local patch was applied to a
throwaway `git clone` in `/tmp` (never touching the real repo) adding the two
missing `COPY` lines; the real `apps/api/Dockerfile` is untouched. This is a
confirmed build-breaking regression sitting in diner-decider's undeployed
range — see Follow-ups.

**Neither project was deployed.** develemail has 55 and diner-decider has 32
commits ahead of their deployed SHAs, spanning many unrelated sprints; per the
sprint's own guidance, this change is inert either way (no Dockerfile uses
`pnpm fetch` yet), so shipping either range blind as a side effect of this
sprint was not worth the risk — and diner-decider's Dockerfile is actively
broken right now, so pushing it would fail at the build step regardless. Both
fixes are committed and ready to ship whenever those repos' own maintainers
review and push their respective ranges.

### Files changed
- `~/projects/develemail/package.json` — removed `pnpm.supportedArchitectures`
  (kept `onlyBuiltDependencies`)
- (new content) `~/projects/develemail/pnpm-workspace.yaml` — added
  `supportedArchitectures` with an explanatory comment
- `~/projects/develemail/.emit-infra.json` — added `ci.imageArchProbes.api`
  (`-migrate` variant, `drizzle-kit` kind)
- `~/projects/diner-decider/package.json` — removed `pnpm.supportedArchitectures`
  (kept `overrides` and `patchedDependencies` untouched)
- (new content) `~/projects/diner-decider/pnpm-workspace.yaml` — added
  `supportedArchitectures` with an explanatory comment
- `~/projects/diner-decider/.emit-infra.json` — added `ci.imageArchProbes.api`
  (`sharp` kind)
- `scripts/lib/image-arch-check.sh` — added `sharp` and `drizzle-kit` probe
  kinds
- `scripts/lib/image-arch-check.test.sh` — 9 new cases covering both kinds,
  pass and fail
- `docs/CROSS-PLATFORM-BUILD-PATTERN.md` — records all three projects now
  keeping the setting in `pnpm-workspace.yaml`, and documents all four probe
  kinds including why `drizzle-kit --version` doesn't work

### Verification
- `pnpm install --frozen-lockfile`: both repos, lockfile hash unchanged,
  exit 0
- diner-decider `package.json` diff: only `supportedArchitectures` removed;
  `overrides` and `patchedDependencies` blocks untouched (confirmed via diff)
- Two-way validation, real Docker images built for `linux/amd64`, run through
  the actual `run_image_arch_checks` entry point (not just raw `docker run`):
  - `drizzle-kit` kind: good migrate image → `✓ image-arch-check: api variant
    -migrate (...develemail-api:9001-migrate) [drizzle-kit]: ok 0.25.12`;
    broken (setting removed) → `✗ ... needs the "@esbuild/linux-x64" package
    instead`
  - `sharp` kind: good api image → `✓ image-arch-check: api
    (...diner-decider-api:9001) [sharp]: ok 0.35.4`; broken → `✗ ... Error:
    Could not load the "sharp" module using the linuxmusl-x64 runtime`
- `scripts/lib/image-arch-check.test.sh`: 34/34 pass (25 prior + 9 new)
- `pnpm test:hooks` (emit-infra): 14 suites, 0 `FAIL` lines, exit 0
- `pnpm check:affected` (develemail): 20 projects, 56/56 tasks (cache hit),
  `✓ check-all (affected) passed`
- `pnpm check:affected` (diner-decider): 8 projects, 21/21 tasks (cache hit),
  `✓ check-all (affected) passed`
- Deploy state: both repos committed, neither deployed (see Summary)

### Follow-ups
- `[blocker]` diner-decider's `apps/api/Dockerfile` fails to build at HEAD —
  `COPY apps/api ./apps/api` / `COPY packages/db ./packages/db` never gained
  entries for `packages/quota-limits` and `packages/db-test-guard` (added
  sprint 88). The next diner-decider deploy that rebuilds `api` will fail at
  `pnpm nx run api:build` inside Docker. Needs two `COPY` line pairs added
  (package.json for the install-cache layer, full source before the build
  step) — a 10-minute fix, but it's a diner-decider Dockerfile change and this
  sprint's "no Dockerfile changes" scope line means it wasn't made here.
- `[defer]` develemail and diner-decider are both several dozen commits ahead
  of their deployed SHAs (55 and 32 respectively) with no deploy attempted by
  this sprint. Whoever picks up either repo next should read the range before
  pushing, not assume it's routine.
- `[defer]` The sprint file suggested `drizzle-kit --version` as the probe
  invocation; it doesn't exercise esbuild and would have been a
  silently-broken probe. Worth a quick skim of any future sprint's suggested
  probe *commands* (not just kinds) before trusting them verbatim — this is
  the second probe-kind sprint in a row (326, 328) where the naive approach
  needed correcting against a real image.
