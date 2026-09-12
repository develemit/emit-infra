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
- [ ] Neither repo has `supportedArchitectures` in `package.json`; both have it in
      `pnpm-workspace.yaml` with a comment explaining why
- [ ] `pnpm install --frozen-lockfile` passes in both repos with no lockfile change
- [ ] diner-decider's `pnpm.overrides` and `pnpm.patchedDependencies` are
      untouched — confirm explicitly in the report
- [ ] Each new probe is demonstrated **both ways**: passing on a correctly built
      image, failing on one built without the setting. Quote both.
- [ ] develemail's `web` has no sharp probe, with the reason recorded
- [ ] Test coverage for the new probe kinds in
      `scripts/lib/image-arch-check.test.sh`
- [ ] `pnpm test:hooks` passes in emit-infra; each touched repo's own check
      command passes
- [ ] Deploy state of both projects is stated plainly — deployed and verified, or
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
