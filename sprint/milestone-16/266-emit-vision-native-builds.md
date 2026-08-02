# Convert emit-vision's Dockerfiles to native arm64 build stages
**Difficulty:** 4

## Goal
emit-vision's four service images (`web`, `api`, `worker`, `marketing`) build
their `deps`/`builder` stages natively on the Apple Silicon host instead of
under QEMU emulation, cutting its measured 200s build phase roughly in half
while still shipping `linux/amd64` images that run healthy in production.

## Reason
The 2026-08-01 measurement (first emit-vision push through the new pipeline,
sha `539f387`): `phases = {ci: 10, auth: 1, build: 200, deploy: 105}`. Build
is now ~2× the entire server-side deploy — the largest remaining cost, and
it's pure emulation overhead. develemail's sprint-255 conversion is the proven
reference (deployed, healthy, pattern documented in `docs/PRE-PUSH-HOOK.md`
"Cross-platform build pattern"). emit-vision is the fleet's second-busiest
deployer; this is the highest-value remaining opt-in.

## Context
- Reference implementation: `~/projects/develemail/apps/{web,api,worker,inbound}/Dockerfile`
  (sprint 255) + the pattern write-up in `docs/PRE-PUSH-HOOK.md`. Follow it,
  including the trap it documents: **stages pinned to `$BUILDPLATFORM` must
  not leak arch-specific artifacts into the shipped stage.**
- The native-module trap, develemail's findings as the map: services whose
  runner copies only a bundled `dist/` (esbuild `bundle: true` output, zero
  `node_modules`) get the full win tax-free; services that ship
  `node_modules` (Next.js standalone → `sharp`) need
  `pnpm.supportedArchitectures` in the workspace root `package.json`
  (develemail uses `cpu: [x64, arm64]`, `os: [linux, darwin, current]`,
  `libc: [musl, glibc]`). Audit emit-vision's four services FIRST: which
  runners copy `node_modules` vs bundled output, and which native deps exist
  (`pnpm.onlyBuiltDependencies`, lockfile platform packages — emit-vision has
  ClickHouse/postgres clients; check for anything compiled).
- emit-vision also has `ci.buildVariants` or build targets? Check
  `.emit-infra.json` (`buildArgs`/`buildTargets`/`buildVariants`) — every
  variant target must be audited for which platform it should resolve to,
  like develemail's `migrate` variant (kept on target platform because it
  executes `node_modules` directly).
- Known dual-arch cost (sprint 255): the workspace-wide
  `supportedArchitectures` field taxes every service's `pnpm install`
  (~5-8s each). Only add it if at least one shipped artifact actually needs
  cross-arch binaries; if all four runners ship bundled output only, skip it
  entirely and the full native win lands untaxed.
- Registry-cache note: changing stage bases invalidates existing caches once.
  The first post-conversion build is cold — measure the SECOND build (and the
  real `phases.build` from an actual push is ground truth).
- Before-number is already recorded: **build: 200s** (all four services,
  emulated, 2026-08-01 push of `539f387`). Put the after-number beside it.
- Verification ladder (same as sprint 255): local
  `docker run --platform linux/amd64` smoke test per converted image →
  real push → all services healthy on the server (`docker ps` + logs via
  `root@<serverIp>` with `~/.ssh/emit-vision-deploy`) →
  `https://api.emitvision.com/healthz` 200.
- emit-vision CI runs six targets (`lint typecheck check-tokens i18n-audit
  test build`) — its own pre-push hook must pass on the conversion commit.
- Deploys of emit-vision as validation are pre-approved by the user.

## Tasks
1. Audit: per service, what the runner stage copies (bundled dist vs
   node_modules), the full native-dep list, and any build
   variants/targets in `.emit-infra.json`. Write the audit down before
   editing.
2. Convert one service first (`api` or whichever the audit says is
   riskiest), smoke-test it emulated locally, then roll out to the rest.
3. Add `pnpm.supportedArchitectures` ONLY if the audit shows a shipped
   artifact needs it (record the decision either way).
4. Push a real deploy; verify every service healthy on the server and
   healthz 200.
5. Record the after-number from the push's `phases.build`; if the first
   build was cache-cold, push one more trivial change to get a warm-cache
   measurement.
6. Update `docs/PRE-PUSH-HOOK.md`'s pattern section only if emit-vision
   taught something develemail didn't (e.g. the untaxed all-bundled path).

## Files involved
- `~/projects/emit-vision/apps/{web,api,worker,marketing}/Dockerfile` — the
  conversion (paths per its repo layout; verify with `ls`)
- `~/projects/emit-vision/package.json` — `supportedArchitectures` only if
  needed per task 3
- `docs/PRE-PUSH-HOOK.md` — pattern addendum only if warranted

## Acceptance criteria
- [x] All four images build with `deps`/`builder` on `$BUILDPLATFORM`; shipped
      stages resolve to `linux/amd64`
- [x] Native-dep audit + runner-contents table in completion notes, written
      before conversion
- [x] `docker run --platform linux/amd64` smoke test per image before the
      real deploy
- [x] Real push deploys healthy (all services up, healthz 200); warm-cache
      `phases.build` recorded next to the 200s baseline, target ≥40% down —
      if measured short of target, report honestly and stop rather than
      forcing it
- [x] emit-vision CI (six targets) green on the conversion commit
- [x] Test coverage: emit-infra untouched expected (`pnpm test:hooks` still
      green); any emit-vision test suite affected stays green
- [x] `supportedArchitectures` decision recorded with reasoning

## Completed

**Date:** 2026-08-02

### Summary
Converted all four emit-vision service Dockerfiles (`api`, `web`, `worker`,
`marketing`) to pin their `builder` stage to `FROM --platform=$BUILDPLATFORM`,
following the develemail sprint-255 pattern exactly. Runner stages were
already plain `FROM node:24-alpine` (emit-vision doesn't use a shared `base`
stage the way develemail's example does), so no other stage needed touching.

Audit before conversion (task 1) found emit-vision is the *fully-untaxed*
case the pattern doc only speculated about: a workspace-wide grep for
`sharp`/`@next/swc-*`/`esbuild`/`@parcel/watcher`/`@swc/core`/`bcrypt`/etc.
across every `package.json` (root, all `apps/*`, all `packages/*`) found
exactly one hit — `apps/extension`, which isn't one of the four converted
services. `api`/`worker` bundle with `tsup` (`noExternal: [/.+/]`) into a
single `.cjs`, so their runner copies zero `node_modules` (the only
`COPY --from=builder` besides the bundle is `geoip-lite`'s static `data/`
directory — data files, not code, arch-independent). `web`/`marketing` ship
Next.js `standalone` output with no native binding anywhere in the traced
dependency graph. `pg-native` appears in both tsup configs' `external` list
defensively but isn't an installed dependency anywhere in the lockfile, so
it's a no-op. Result: **`pnpm.supportedArchitectures` was deliberately not
added** — every shipped artifact is architecture-independent, so the
workspace-wide install tax the setting would impose has no offsetting
benefit here.

Runner-contents table (native-dep audit, task 1):

| service   | runner ships          | native deps in shipped surface | verdict |
|-----------|------------------------|----------------------------------|---------|
| api       | `tsup` bundled `.cjs` + `migrate.cjs`×2 + geoip-lite data | none | untaxed |
| worker    | `tsup` bundled `.cjs` | none | untaxed |
| web       | Next.js `standalone` + `static` | none (`sharp` not a dependency) | untaxed |
| marketing | Next.js `standalone` + `static` + `public` | none | untaxed |

Local smoke tests (task 2/acceptance criterion 3) — `docker buildx build
--platform linux/amd64 ... --load` followed by `docker run --platform
linux/amd64` per image — passed for all four: `api`/`worker` failed cleanly
on a missing `DATABASE_URL` env var (expected, not an exec-format error);
`web`/`marketing` started their Next server cleanly with no env vars set.
No arch mismatch anywhere.

Real deploy (task 4) pushed clean: all four services healthy on the blue
slot, `healthz` 200, Postgres/ClickHouse migrations ran successfully. Per
the pattern doc's cache-cold warning, pushed a second small commit (adding
explanatory comments to the four Dockerfiles' builder-pin line, matching the
doc's own suggested comment style) to get a genuine warm-cache
`phases.build` reading. Both pushes measured identically:

- Baseline (2026-08-01, `539f387`, emulated): **build: 200s**
- After (2026-08-02, `490db8f`, cache-cold): **build: 119s** (-40.5%)
- After (2026-08-02, `f9cf321`, warm-cache): **build: 119s** (-40.5%, confirmed stable)

Hit the ≥40% target on both measurements — no gap between cold and warm
readings, consistent with the "fully untaxed, fully bundled" case having
nothing extra for a warm cache to save on beyond what native execution
already saves over emulation.

Updated `docs/PRE-PUSH-HOOK.md`'s native-module-trap section (task 6) with a
short addendum documenting emit-vision as a confirmed real-world instance of
the untaxed path — the doc previously only described the tax/no-tax
distinction hypothetically.

### Files changed
- `~/projects/emit-vision/apps/api/Dockerfile` — pin `builder` to
  `$BUILDPLATFORM`, add explanatory comment
- `~/projects/emit-vision/apps/web/Dockerfile` — same
- `~/projects/emit-vision/apps/worker/Dockerfile` — same
- `~/projects/emit-vision/apps/marketing/Dockerfile` — same
- `docs/PRE-PUSH-HOOK.md` — addendum documenting emit-vision's fully-untaxed
  case under "The native-module trap"
- `sprint/266-emit-vision-native-builds.md` — this file

### Verification
- Local `docker buildx build --platform linux/amd64 --load` + `docker run`:
  4/4 images pass, no exec-format errors
- Real push ×2 (`490db8f`, `f9cf321`): both deployed successfully, all
  services healthy, `https://api.emitvision.com/healthz` → 200
- emit-vision pre-push CI (lint, typecheck, check-tokens, i18n-audit, test,
  build) on the conversion commit: `✓ CI passed (490db8f...)`
- `pnpm test:hooks` (emit-infra, untouched by this sprint): 36/36 passed
- `phases.build`: 200s → 119s → 119s (-40.5%, target ≥40% met and stable
  across cold/warm cache)

### Follow-ups
- `[defer]` emit-vision's `apps/extension` still has `sharp` as a dependency
  but wasn't part of this sprint's scope (only web/api/worker/marketing) —
  worth a quick check whether `extension` ships as a Docker image at all
  before assuming it's untouched by this pattern.
- none other

## Out of scope
- Scoped dual-arch installs (still the parked item-4 decision)
- Other projects' conversions (sprints 267–268)
- `EMIT_BUILD_PARALLEL` default changes
