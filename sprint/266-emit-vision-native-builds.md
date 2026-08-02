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
- [ ] All four images build with `deps`/`builder` on `$BUILDPLATFORM`; shipped
      stages resolve to `linux/amd64`
- [ ] Native-dep audit + runner-contents table in completion notes, written
      before conversion
- [ ] `docker run --platform linux/amd64` smoke test per image before the
      real deploy
- [ ] Real push deploys healthy (all services up, healthz 200); warm-cache
      `phases.build` recorded next to the 200s baseline, target ≥40% down —
      if measured short of target, report honestly and stop rather than
      forcing it
- [ ] emit-vision CI (six targets) green on the conversion commit
- [ ] Test coverage: emit-infra untouched expected (`pnpm test:hooks` still
      green); any emit-vision test suite affected stays green
- [ ] `supportedArchitectures` decision recorded with reasoning

## Out of scope
- Scoped dual-arch installs (still the parked item-4 decision)
- Other projects' conversions (sprints 267–268)
- `EMIT_BUILD_PARALLEL` default changes
