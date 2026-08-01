# Run Docker build stages natively on arm64, emit amd64 images
**Difficulty:** 4

## Goal
Restructure develemail's Dockerfiles (and emit-infra's scaffold templates, if
any exist) so the expensive `deps` and `builder` stages run natively on the
Apple Silicon build host instead of under QEMU emulation, while the final image
still targets `linux/amd64` for the Hetzner x86 servers. Target: cut per-service
build time roughly in half or better.

## Reason
Every image build runs fully emulated (`--platform linux/amd64` on an arm64
Mac). Measured cost: 50–90s per service, and it's the reason
`EMIT_BUILD_PARALLEL` is pinned to 1 (two concurrent emulated Node builds
exhaust the Docker VM's memory). Node is interpreted — `pnpm install` and the
nx build don't need the target architecture; only the thin runtime stage does.
This keeps all builds on local hardware, per the project's no-external-infra
constraint, and makes the future option of parallel builds viable again.

## Context
- develemail Dockerfiles: `apps/web/Dockerfile`, `apps/api/Dockerfile` (has a
  `migrate` variant target used via `ci.buildVariants`), `apps/worker/Dockerfile`,
  `apps/inbound/Dockerfile`. Current shape (web/api verified): 4 stages —
  `base` (node:22-alpine) → `deps` (pnpm install) → `builder` (nx build) →
  `runner` (copies artifacts; api also has `migrate` FROM node:22-alpine).
- The technique: build stages that only produce JS artifacts get
  `FROM --platform=$BUILDPLATFORM node:22-alpine AS deps` (BuildKit runs them
  on the host arch natively); the `runner`/`migrate` stages keep plain `FROM`
  so they resolve to the requested `--platform linux/amd64`.
- **The native-module trap — the core risk of this sprint**: anything with a
  compiled binary (`sharp` is confirmed present for Next.js image handling;
  audit for `bcrypt`, `esbuild`, `better-sqlite3`, etc.) will be installed as
  **arm64** binaries in a `$BUILDPLATFORM` deps stage, then copied into an
  amd64 runner → crash at runtime. Handle with pnpm's `supportedArchitectures`
  (in `.npmrc` or install flags: `supportedArchitectures.os=linux`,
  `supportedArchitectures.cpu=x64` — or `cpu=["arm64","x64"]` so the build
  stage can also *run* tools it needs). Next.js standalone output bundles
  `node_modules` into `.next/standalone`, so web's runner inherits whatever
  arch deps installed — this must be x64.
  - `esbuild`-family tools are the inverse case: they must *execute* during the
    build, so the build stage needs the arm64 binary too. `cpu=["arm64","x64"]`
    installs both; verify the final artifact ships x64.
- Audit each service's runner stage for `RUN` commands — those still run under
  QEMU (fine if trivial, e.g. `chown`; flag if heavy).
- Scaffold templates: check whether emit-infra generates Dockerfiles for new
  projects — likely candidates `apps/cli/src/commands/init-deploy.ts` or
  `apps/cli/src/lib/` (grep for `Dockerfile`). If templates exist, apply the
  same pattern there; if not, document the pattern in `docs/PRE-PUSH-HOOK.md`
  instead.
- The hook's build invocation (`scripts/lib/docker-build.sh`) needs no change —
  `--platform linux/amd64` + BuildKit resolve `$BUILDPLATFORM` automatically.
- Registry cache note: sprint 252 shipped `--cache-from type=registry` +
  inline cache. Changing stage bases invalidates existing caches once — the
  first build after this lands is a cold build; don't misread it as a
  regression. Measure the *second* build.
- Measurement: time `docker buildx build` per service before/after (3 runs,
  warm cache). The `.deploy-history.jsonl` `phases.build` numbers from real
  pushes are the ground truth.

## Tasks
1. Audit develemail's four Dockerfiles + `pnpm-lock.yaml` for native
   dependencies (`grep -r "sharp\|bcrypt\|esbuild\|node-gyp\|prebuild" ...` and
   inspect lockfile for platform-specific packages). List every one and its
   role (runtime vs build-time) before touching anything.
2. Record before-numbers: warm-cache build time per service on the current
   Dockerfiles.
3. Convert one service first — `api` (has the migrate variant, exercises the
   most paths). `$BUILDPLATFORM` on base/deps/builder, `supportedArchitectures`
   pinning, runner unchanged.
4. Prove correctness for api before proceeding: build the amd64 image, then
   `docker run --platform linux/amd64` it locally (emulated) far enough to
   confirm the app boots and any native module loads (a crash here = arch
   mismatch). Do the same for the migrate variant.
5. Roll the pattern out to web (mind Next standalone + sharp), worker, inbound.
6. Record after-numbers (warm cache, 3 runs each); compute the delta.
7. Push a real develemail deploy; verify all services healthy on the server —
   this is the definitive native-module check.
8. Re-test parallel builds: with native stages, try `EMIT_BUILD_PARALLEL=2`
   for one build round and watch Docker VM memory. If comfortably safe, note
   it in `docs/PRE-PUSH-HOOK.md` as a recommended setting — do **not** change
   the default of 1 this sprint.
9. Apply the pattern to emit-infra's Dockerfile scaffold templates if found
   (task 1 of this file's Context); otherwise add a "cross-platform build
   pattern" section to `docs/PRE-PUSH-HOOK.md` with the api Dockerfile as the
   reference example.
10. Commit develemail changes in develemail, emit-infra changes in emit-infra.

## Files involved
- `~/projects/develemail/apps/{web,api,worker,inbound}/Dockerfile` — the
  conversion
- `~/projects/develemail/.npmrc` (or per-Dockerfile install flags) —
  `supportedArchitectures`
- `apps/cli/src/commands/init-deploy.ts` / `apps/cli/src/lib/` — scaffold
  templates, if Dockerfile generation exists there
- `docs/PRE-PUSH-HOOK.md` — pattern documentation + parallel-build note
- `scripts/lib/docker-build.sh` — expected unchanged; touch only if a real
  blocker demands it

## Acceptance criteria
- [ ] Warm-cache build time per service reduced ≥40% (before/after table in
      completion notes; ground truth from `phases.build` on real pushes)
- [ ] Deployed develemail runs healthy on the x86 server — every service,
      including the migrate variant (native modules load, no exec-format or
      arch errors in server logs)
- [ ] `docker run --platform linux/amd64` smoke test passed locally for each
      converted image before the real deploy
- [ ] Native-dependency audit list included in completion notes
- [ ] Scaffold templates updated **or** pattern documented in
      `docs/PRE-PUSH-HOOK.md` (whichever task 9 determined)
- [ ] Test coverage: if scaffold template code changes,
      `apps/cli/src/commands/init-deploy.test.ts` asserts the generated
      Dockerfile contains the `$BUILDPLATFORM` pattern; emit-infra
      typecheck/lint/test and `pnpm test:hooks` green
- [ ] develemail CI (its own pre-push targets) green on the Dockerfile commit

## Out of scope
- Changing `EMIT_BUILD_PARALLEL` default (measure and document only)
- Hetzner CAX/ARM server migration
- Registry cache mode changes (`mode=max`, `:buildcache` tags, ghcr-prune
  interactions)
- Converting other projects' Dockerfiles (pattern + docs unblock them; each
  project converts when touched)
