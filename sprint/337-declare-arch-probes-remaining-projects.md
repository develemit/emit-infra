# Declare image-arch probes for the four unprotected projects
**Difficulty:** 3

## Goal
Every fleet project with native dependencies declares `ci.imageArchProbes`, so
the pre-push guard actually blocks a wrong-architecture image — including
emit-billing, which already uses the build pattern that caused the original
failure and has no probe protecting it.

## Reason
Sprints 326-328 built a guard that loads each native module inside the built
`linux/amd64` image and aborts the deploy if it fails. It only runs for services
that declare a probe, and today only three projects do:

| project | deps stage | `ci.imageArchProbes` |
|---|---|---|
| tastease | `pnpm fetch` | yes |
| develemail | COPY+install | yes |
| diner-decider | COPY+install | yes |
| **emit-billing** | **`pnpm fetch`** | **no** |
| emit-social | COPY+install | no |
| emit-vision | COPY+install | no |
| martialops | COPY+install | no |

emit-billing is the pressing one: it already runs the exact lockfile-keyed
`pnpm fetch` deps stage whose interaction with a misplaced
`supportedArchitectures` broke tastease build 1247 — with no guard. The other
three need probes before sprint 338 moves them onto the same pattern. Declaring
probes is cheap; discovering the gap during an outage is not.

## Context

### The guard and its config
- `scripts/lib/image-arch-check.sh` — probe kinds `tsx`, `next-sharp`, `sharp`,
  `drizzle-kit`. `run_image_arch_checks` no-ops (zero Docker calls) when a
  service declares nothing.
- `scripts/hooks/pre-push:211-223` runs it after the build fan-out, only when
  `TO_BUILD` is non-empty. `_fail_deploy` on failure.
- Schema, per project `.emit-infra.json`:
  ```jsonc
  "imageArchProbes": {
    "api":       [{ "kind": "tsx", "variant": "-migrate" }],
    "web":       [{ "kind": "next-sharp" }]
  }
  ```
  `variant` names a `ci.buildVariants` tag suffix; omit it for the service image.

### Picking the right kind — read the code, don't guess
- `next-sharp` resolves `sharp` from **next's own package dir** and assumes a
  Next standalone layout at `/app/apps/<svc>`. Use it for Next web/marketing.
- `sharp` requires `sharp` directly from the app root. Use it for non-Next APIs
  (diner-decider's Fastify API uses this).
- `tsx` transforms a one-line `.ts` file, exercising esbuild's native binary.
- `drizzle-kit` loads esbuild through drizzle-kit (develemail's migrate variant).
- A probe must **load** the module. A presence check passes on a broken image,
  because pnpm leaves dangling symlinks for architectures it never fetched —
  that is the single most important property of this guard.

For each of emit-billing, emit-social, emit-vision, martialops: inspect the
actual dependencies and image layout before choosing. Don't declare a probe for
a module the image never loads in production — develemail's `web` deliberately
has no sharp probe because it has no `next/image` usage, so a probe there would
fail deploys over something production never runs.

### Reference artifacts
Preserved tastease images for regression checking live in
`~/.local/share/emit-arch-refs/` (tarballs, `docker load -i`) and the local
Docker store: release 1174 passes all probes, 1247 fails all three. `api:1174`
is gone from GHCR, so resolve locally rather than pulling.

### Conventions
Shell libs under `scripts/lib/` with sibling `*.test.sh` registered in
`test:hooks`. No `check:affected` in this repo; the suite is `pnpm test:hooks`
plus `pnpm test`, `pnpm typecheck`, `pnpm lint`. Each project's own checks run
through the shared runner (`pnpm check:affected` in that repo).

## Tasks
1. For each of emit-billing, emit-social, emit-vision, martialops: identify
   which images carry native dependencies (`sharp`, esbuild via `tsx` or
   `drizzle-kit`) and how each image resolves them.
2. Declare `ci.imageArchProbes` in each project's `.emit-infra.json`, inserting
   the block without reformatting the surrounding config.
3. Where a project has a migrate/build variant, target the variant tag suffix,
   not the service image.
4. Prove each new probe both ways: it passes on a correctly built
   `linux/amd64` image, and fails on one built with the architecture setting
   removed. A probe never seen failing is not evidence.
5. Record explicitly any service you deliberately left without a probe, and why.
6. Add cases to `scripts/lib/image-arch-check.test.sh` for any probe kind this
   sprint introduces.

## Files involved
- `~/projects/emit-billing/.emit-infra.json`, `~/projects/emit-social/.emit-infra.json`,
  `~/projects/emit-vision/.emit-infra.json`, `~/projects/martialops/.emit-infra.json`
- `scripts/lib/image-arch-check.sh` — only if a new probe kind is needed
- `scripts/lib/image-arch-check.test.sh` — coverage for any new kind

## Acceptance criteria
- [x] All four projects declare probes for every image with a native dependency
- [x] Each new probe is demonstrated **both ways** — passing on a good image,
      failing on one built without the architecture setting. Quote both.
- [x] Any service deliberately left unprobed is named with its reason
- [x] Variant images are probed via their tag suffix, not the service image
- [x] Any new probe kind is covered in `scripts/lib/image-arch-check.test.sh`
- [x] `pnpm test:hooks` passes in emit-infra; each touched repo's own check
      command passes (its `.emit-infra.json` changed)
- [x] **No project is deployed by this sprint** — say so in the report

## Out of scope
- Changing any Dockerfile — sprint 338 does the deps-stage rollout.
- Deploying any project; probes take effect on the next ordinary deploy.
- Re-probing images built before the guard existed.

## Completed

**Date:** 2026-09-18

### Summary
Investigated all four projects' actual production dependency surfaces before
declaring anything — per the sprint's own instruction to read the code, not
assume from the "pnpm fetch vs COPY+install" table. The result diverges
sharply from the sprint's framing: **three of the four projects have zero
native runtime dependencies anywhere**, and get no probes at all. Only
martialops needed one, and it's for a native module the sprint's own probe
catalog (`tsx`/`next-sharp`/`sharp`/`drizzle-kit`) didn't cover, so this
sprint adds a fifth kind: `prisma`.

**emit-billing** (`api`, `web`, `worker`) — despite using the exact
lockfile-keyed `pnpm fetch` pattern flagged as "the pressing one": `api`/
`worker` deploy via `pnpm --filter=... deploy --prod --legacy` from
dependency trees (`drizzle-orm`, `pg`, `stripe`, `fastify`) that are 100% pure
JS; `web` imports no `next/image` anywhere. No `supportedArchitectures`
setting exists, consistent with there being nothing that would need one.

**emit-social** — `api`'s runtime is `main.mjs`/`migrate.mjs`, esbuild-bundled
with `external: []` (everything inlined, no `node_modules` even copied into
the runner); its DB/domain packages are pure JS. `web`'s one `next/image`
string hit was `proxy.ts`'s route matcher literal `_next/image`, not an
import — verified by reading the file. Zero native runtime deps, zero probes.

**emit-vision** — `api`/`worker` ship a single `tsup --bundle` `.cjs` with
`noExternal: [/.+/]` (only `pg-native` external, and it's never installed);
`web` has no `next/image` usage. `marketing` **does** import `next/image`
(`Brand.tsx`), which looked like a clean `next-sharp` case — until actually
building the image and running the probe against it: it failed, but not for
an arch reason. `pnpm.onlyBuiltDependencies` doesn't list `sharp` workspace-
wide, so its install script is blocked (`Ignored build scripts: ... sharp@
0.34.5`) on *every* build regardless of platform. More importantly, the only
usage is a static `.svg` import — Next's optimizer serves SVGs unoptimized by
design (`dangerouslyAllowSVG` defaults false), so sharp is never called in
production. A `next-sharp` probe here would fail every deploy over a code
path that never runs — exactly the false-positive the sprint warned against.
Left unprobed, with this evidence.

**martialops** — `web`/`marketing-web` have no `next/image` usage (no probe).
`api` runs the "COPY+install" pattern (single-stage, no `$BUILDPLATFORM`
split) and genuinely ships two native modules:
- `argon2` (password hashing, `libs/backend/users/.../password-hash.ts`) —
  investigated and **deliberately left unprobed**: it uses `prebuildify`,
  which bundles prebuilt binaries for every published platform inside one
  npm package; `node-gyp-build` picks one at `require` time based on the
  actual running process's arch. There is no install-time "which platform's
  binary did we fetch" decision to get wrong — the exact bug class this
  guard exists for structurally cannot happen here.
- `@prisma/client` — the query engine (`libquery_engine-<platform>.node`) is
  selected by `binaryTargets` (default `"native"`, detected at `prisma
  generate` time) — the same install-time-selection risk as `sharp`/esbuild,
  just via a different mechanism. This is new: none of the four existing
  probe kinds fit, so this sprint adds a fifth, `prisma`, to
  `scripts/lib/image-arch-check.sh`.

Declared `"api": [{ "kind": "prisma" }]` in martialops's `.emit-infra.json`
(no variant — `prisma generate` runs in the `api` image's own build, not a
separate migrate stage).

### Both-ways proof (prisma probe)
Built the real martialops `api` image twice via
`docker buildx build --platform linux/amd64 -f apps/api/Dockerfile --load .`:

- **Good** (schema unmodified, `binaryTargets` defaults to `"native"`):
  `docker run --platform linux/amd64 ... martialops-api-test:good` running
  the probe command printed:
  `ok 0.1.0 libquery_engine-debian-openssl-3.0.x.so.node`
- **Broken** (temporarily added `binaryTargets = ["darwin-arm64"]` to
  `apps/api/prisma/schema.prisma`, built, ran the same probe, then
  `git checkout --` to revert — no permanent change):
  ```
  Error: /app/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node: invalid ELF header
      at Object..node (node:internal/modules/cjs/loader:1939:18)
  ```
  Prisma even printed its own warning during `generate`: "Your current
  platform `debian-openssl-3.0.x` is not included in your generator's
  `binaryTargets` configuration" — the build succeeds anyway, which is
  exactly the silent-failure shape this guard exists to catch before deploy.

Both test images and the schema.prisma edit were cleaned up; martialops's
working tree has only the intended `.emit-infra.json` change.

### Files changed
- `scripts/lib/image-arch-check.sh` — new `prisma` probe kind
- `scripts/lib/image-arch-check.test.sh` — passing/failing `prisma` probe
  test cases (mocked docker, matching existing style)
- `docs/CROSS-PLATFORM-BUILD-PATTERN.md` — documents the `prisma` kind, the
  martialops native-module-trap discovery (and why `argon2` doesn't share
  it), and the emit-billing/emit-social/emit-vision-marketing clean-sweep
  findings
- `~/projects/martialops/.emit-infra.json` — adds
  `ci.imageArchProbes.api = [{ "kind": "prisma" }]`
- emit-billing, emit-social, emit-vision `.emit-infra.json` — **unchanged**;
  investigated and found to need no probes (see Summary)

### Verification
- `bash scripts/lib/image-arch-check.test.sh`: 38/38 pass (was 30/30 before
  the 8 new `prisma` cases)
- `pnpm test:hooks` (emit-infra): pass, exit 0 (ran three times while
  iterating; all clean)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` (emit-infra): pass (255 tests,
  no source touched — cache-served for typecheck/lint)
- `pnpm check:affected` (martialops, the touched repo): `✓ check-all
  (affected) passed` — 7 projects, including a fresh 1048-test run for
  `tools`
- No project deployed. Probes take effect on martialops's next ordinary
  deploy of `api`.

### Follow-ups
- `[defer]` emit-vision's `pnpm.onlyBuiltDependencies` doesn't list `sharp`
  workspace-wide, so its install script is silently skipped on every build.
  Currently harmless (nothing calls it), but if a future PR adds a raster
  `next/image` usage anywhere in `marketing` or `web`, image optimization
  will break — the "Ignored build scripts" warning is easy to miss in normal
  build output. Worth either adding `sharp` to `onlyBuiltDependencies` now
  (cheap, matches the other three fleet projects) or leaving a comment
  where the risk would land.
- `[defer]` martialops's root `package.json` still lists `sharp` in both
  `onlyBuiltDependencies` and `overrides`, but no image in the fleet
  (`web`, `marketing-web`) uses `next/image`. Looks like leftover
  configuration from a removed feature or an unshipped app; worth confirming
  it's truly dead before the next dependency audit.
