# Evaluate the platform split for martialops' api image
**Difficulty:** 3

## Goal
martialops' `apps/api` image either adopts the fleet's native-build pattern, or
has a written reason why it shouldn't — decided by measurement rather than left
as the one image that quietly differs.

## Reason
Every other fleet image builds its JS artifacts natively and reserves the
requested `--platform` for the runner stage. martialops' `apps/api/Dockerfile`
is the exception on two counts (verified 2026-09-18, after sprint 338 converted
its deps stage):

- **No `--platform=$BUILDPLATFORM` anywhere**, so `deps` and `builder` run under
  emulation for `linux/amd64` on an arm64 Mac — the slowest possible way to
  produce platform-independent JavaScript.
- **The runner stage installs its own copy** of `@prisma/client`, `prisma` and
  `argon2` (it copies their `package.json` files to `/tmp` and installs from
  there) instead of copying `node_modules` from the builder.

That second point is not obviously wrong: those are the repo's genuine native
modules, and installing them in the runner is one way to get the right binaries
for the target platform. It may well be deliberate. But it is undocumented and
it interacts with the `prisma` arch probe sprint 337 added, so it deserves a
decision on the record rather than drift.

## Context

### The current shape
`~/projects/martialops/apps/api/Dockerfile`:
- `FROM node:22-bookworm-slim AS base` (line ~10) — no `$BUILDPLATFORM`
- `deps` (~21) — sprint 338's lockfile-keyed `pnpm fetch` stage
- `builder` (~38) — `COPY --from=deps /app ./`, then `pnpm exec tsup`
- `runner` (~50) — copies `prisma`/`argon2`/`@fastify/swagger-ui`
  `package.json` files to `/tmp`, installs from there, then copies
  `apps/api/prisma` and `dist/apps/api` from the builder

### The reference
`~/projects/tastease/apps/api/Dockerfile` — `FROM --platform=$BUILDPLATFORM
node:22-alpine AS base`, with the comment explaining that `deps`/`builder` only
produce architecture-independent JS so they run natively, and only `runner` uses
the requested platform. Read it before changing anything.

### The constraint that makes this non-trivial
Prisma's query engine is selected at `prisma generate` time by `binaryTargets`
(default `native`). If generation moves to a native-arch builder stage while the
runner is `linux/amd64`, the generated engine is for the wrong platform — the
exact failure sprint 337's `prisma` probe was built to catch, and it
demonstrated that failure live (`invalid ELF header`). So any change here must
keep `prisma generate` producing an engine for the **runner's** platform, and
the probe must pass afterwards. The same question applies to `argon2`, though
sprint 337 established that one is structurally safe: it uses `prebuildify` and
picks its binary at require time.

### Measuring
Record a cold `docker build --platform linux/amd64` time before and after. If
the split doesn't meaningfully improve it — plausible, since the heavy native
work is in the runner either way — then **don't make the change**; write up the
measurement and the reason, and leave the Dockerfile alone. A sprint that
concludes "measured, not worth it" with numbers is a success here.

### Conventions
martialops runs the fleet-shared runner (`pnpm check:affected`). Dockerfiles sit
outside the Nx graph, so that may report no tasks — the real evidence is a
successful `linux/amd64` build plus the `prisma` arch probe passing. Run the
probe via emit-infra's `scripts/lib/image-arch-check.sh`, the same way sprint
337 did.

## Tasks
1. Record a cold `linux/amd64` build time for the current Dockerfile.
2. Work out whether `deps`/`builder` can run on `$BUILDPLATFORM` while
   `prisma generate` still produces an engine for the runner's platform. Read
   how the current file sequences generation before deciding.
3. If it can: make the change, rebuild, and confirm the `prisma` probe passes.
4. If it can't, or the measured gain is negligible: leave the Dockerfile
   unchanged and write up why, with the numbers.
5. Either way, document the runner's separate install decision in a comment in
   the Dockerfile, so the next reader doesn't have to re-derive it.
6. Do not deploy.

## Files involved
- `~/projects/martialops/apps/api/Dockerfile` — platform split, or a comment explaining its absence

## Acceptance criteria
- [ ] Before/after cold `linux/amd64` build times are recorded, whichever way
      the decision goes
- [ ] If changed: the image builds for `linux/amd64` and the `prisma` arch probe
      passes — quote the probe output
- [ ] If unchanged: the reason is written into the sprint's Completed section
      **and** as a comment in the Dockerfile
- [ ] The runner's separate `prisma`/`argon2` install is explained in a comment
      either way
- [ ] `pnpm check:affected` run in martialops, with an empty affected result
      reported honestly rather than as a pass
- [ ] martialops is not deployed, and the report says so

## Out of scope
- The other two martialops images (`web`, `marketing-web`) unless the same
  change is trivially identical — say so if you skip them.
- Changing how Prisma is generated at the application level.
- Deploying martialops.
