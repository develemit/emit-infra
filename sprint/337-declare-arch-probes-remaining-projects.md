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
- [ ] All four projects declare probes for every image with a native dependency
- [ ] Each new probe is demonstrated **both ways** — passing on a good image,
      failing on one built without the architecture setting. Quote both.
- [ ] Any service deliberately left unprobed is named with its reason
- [ ] Variant images are probed via their tag suffix, not the service image
- [ ] Any new probe kind is covered in `scripts/lib/image-arch-check.test.sh`
- [ ] `pnpm test:hooks` passes in emit-infra; each touched repo's own check
      command passes (its `.emit-infra.json` changed)
- [ ] **No project is deployed by this sprint** — say so in the report

## Out of scope
- Changing any Dockerfile — sprint 338 does the deps-stage rollout.
- Deploying any project; probes take effect on the next ordinary deploy.
- Re-probing images built before the guard existed.
