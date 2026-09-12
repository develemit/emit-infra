# Block deploys whose images carry the wrong platform's native binaries
**Difficulty:** 4

## Goal
A shared pre-push guard that, for every image declaring native dependencies,
runs on the target platform and **loads** each native module. If a module fails
to load, the deploy is aborted before anything reaches a server. Projects that
declare nothing skip it and pay nothing.

## Reason
On 2026-09-11 tastease's build 1247 built green, pushed to GHCR, and died on the
x64 server at the pre-deploy migration: `tsx` crashed with `"@esbuild/linux-arm64"
is present but this platform needs "@esbuild/linux-x64"`. Its web and marketing
images shipped arm64-only `sharp` in the same build. Root cause: images are built
on an arm64 Mac for x64 servers (see `docs/CROSS-PLATFORM-BUILD-PATTERN.md`), and
sprint 141 in tastease moved `pnpm fetch` ahead of `COPY package.json`, so pnpm
never saw `supportedArchitectures` and fetched only the build host's binaries.

**No local check in any project can catch this class of bug** — every machine in
this fleet builds and tests on arm64; only prod is x64. The only existing
safety net is accidental: tastease's migration step happens to run `tsx`, so it
crashed loudly. That net has a hole — tastease's `.deploy-history.jsonl` contains
25 deploys that rebuilt only web and/or marketing, where `migratePre` reuses the
previous migrate image. A `sharp` regression in one of those ships silently and
breaks `/_next/image` in production with nothing failing.

This is also about to get worse on purpose. Two open items in `backlog.md`
(shared deps stage; lockfile-keyed deps layer) propose rolling tastease's exact
deps-stage pattern out fleet-wide. develemail and diner-decider both still keep
`supportedArchitectures` in `package.json`, so both break the moment that lands
(sprint 328 fixes them). A guard has to exist before that rollout, not after.

## Context

### Where this must run, and why it can't run earlier
`scripts/lib/docker-build.sh`'s `build_image()` builds with `--platform
linux/amd64 ... --push`, so **the build and the GHCR push are one step** — there
is no window between them. Builds also run in parallel via
`run_build_fanout` (`scripts/lib/deploy-plan.sh:29-41`).

So the guard goes in `scripts/hooks/pre-push` **between the build fan-out
(line 217, `run_build_fanout "$MAX_PARALLEL" _fail_deploy "${TO_BUILD[@]}"`) and
the deploy (line 241-244, `→ running emit-infra deploy`)**. A bad image will
exist in GHCR under its tag; it will never be deployed. That is the correct
trade: `scripts/ghcr-prune.sh` already tolerates unused versioned tags, and
restructuring `build_image` to `--load` + separate push would change caching and
parallelism for every project in the fleet — out of scope here.

Failing must call the same `_fail_deploy` path the build fan-out uses, so
`.deploy-status.json` lands on `failed` rather than sticking at `deploying`
(the bug sprint 267 fixed; see the comment above `run_build_fanout`).

### Preserved reference artifacts (read before validating)
`scripts/ghcr-prune.sh` keeps only the 10 most recent versions per image and runs
weekly (Sundays 03:17). On 2026-09-12 `api:1174-migrate` and `api:1174` sat at
ranks 12 and 15 in that ordering — past the keep-10 cutoff — so **expect them to
be gone from GHCR**. They were pulled for `linux/amd64` and preserved before the
next prune run:

- Loaded in the local Docker store as `ghcr.io/develemit/easyliving/<img>:<tag>`
  for all eight of `api|web|marketing` x `1174|1247` (plus the two `-migrate` tags).
- Archived as tarballs in `~/.local/share/emit-arch-refs/` (`easyliving-api-*.tar`),
  since `docker image prune -a` would otherwise reclaim them as unused. Restore
  with `docker load -i <tar>`.

So: **resolve reference images locally; never assume a registry pull will work.**
`web:1174`/`web:1247` and the `marketing` pair were still in GHCR at the time of
writing (ranks 2-6), but `api:1247` sat at rank 9 — one tastease deploy from
eviction — so treat the local copies as the source of truth for all of them.
This does not change the guard's own behaviour for *newly built* images, which
are present locally right after the build; it only affects this validation step.

### Getting the image to probe
`build_image` pushes rather than `--load`s, but in practice the built image has
also been present in the local Docker store (tastease's 1247 images were
inspectable locally right after the failed deploy). **Verify that rather than
assuming it**: probe the local image if present, otherwise `docker pull
--platform linux/amd64` the tag just built. Either way the probe must pass
`--platform linux/amd64` explicitly to `docker run`, since the host is arm64 and
would otherwise pick the host architecture.

### Config
Follow the existing shape in `scripts/lib/pre-push-config.sh:16-45`: it reads
`.emit-infra.json` via an inline `python3` block and emits shell vars, e.g.
`out('BUILD_VARIANTS_JSON', json.dumps(ci.get('buildVariants', {})))`. Add
`ci.imageArchProbes` the same way (`IMAGE_ARCH_PROBES_JSON`), defaulting to `{}`
so every project that declares nothing keeps working untouched.

Probes are per-image and must name the tag suffix where relevant, because
tastease's migration image is a **build variant** (`buildVariants`, tag suffix
`-migrate`), not a service image. A shape that covers the three known projects:

```jsonc
"imageArchProbes": {
  "api":       [{ "variant": "-migrate", "kind": "tsx" }],
  "web":       [{ "kind": "next-sharp" }],
  "marketing": [{ "kind": "next-sharp" }]
}
```

Prefer a small set of named `kind`s over free-form shell, so probes stay
reviewable and identical across projects. Two kinds cover the fleet today
(`tsx`, `next-sharp`); diner-decider needs a third in sprint 328 (`sharp`
required directly from the app root, not via next).

### The probes themselves — details earned the hard way
`~/projects/tastease/scripts/check-image-arch.sh` (57 lines, committed in
tastease `c3e0744`) is the working reference. **Read it before writing this.**
Non-obvious properties it must keep:

- **Load the module; never check that the package exists.** The failure leaves a
  *dangling symlink*: `node_modules/.pnpm/@esbuild+linux-x64@0.27.4/` and the
  link into it both exist, but the package directory they point at does not. So
  `ls node_modules/.pnpm | grep linux-x64` **passes on a broken image**. This is
  the single most important property of this sprint.
- **`sharp` resolves only from next's own package dir.** It is an optional
  dependency of `next`, so `require('sharp')` from the app root fails even on a
  known-good image. Use
  `createRequire(require.resolve('next/package.json'))('sharp')`.
- **Starting the container proves nothing for lazily-loaded modules.** A Next
  standalone image starts cleanly with broken `sharp`, because `sharp` only
  loads on the first `/_next/image` request. The old advice in
  `docs/CROSS-PLATFORM-BUILD-PATTERN.md` said to start the container; it would
  have passed build 1247. That doc was corrected in `2143216` — do not
  reintroduce the weaker check here.
- **For `tsx`, transform a one-line `.ts` file with `npx tsx`.** Set
  `NPM_CONFIG_UPDATE_NOTIFIER=false` and match a sentinel line (`grep -q '^ok'`)
  rather than the last line of output: `npx` prints an npm update notice *after*
  the real output, which made the reference script's first version report a
  known-good release as broken.

### Conventions
Shell libs live in `scripts/lib/<name>.sh` with a sibling `<name>.test.sh`, and
every test file is registered in the root `package.json`'s `test:hooks` script
(see `docker-build.test.sh`, `deploy-detached.test.sh`). There is **no
`check:affected`** in this repo — `pnpm test:hooks` is the suite for shell libs.

## Tasks
1. Read `~/projects/tastease/scripts/check-image-arch.sh` and
   `docs/CROSS-PLATFORM-BUILD-PATTERN.md`'s "Verify before shipping" section.
2. Write `scripts/lib/image-arch-check.sh` exposing a function the hook can call
   for a list of built services, with named probe kinds (`tsx`, `next-sharp`).
   Resolve the image locally first, falling back to `docker pull`.
3. Add `ci.imageArchProbes` to `scripts/lib/pre-push-config.sh`, defaulting to
   `{}`.
4. Wire it into `scripts/hooks/pre-push` between line 217 and line 241. On
   failure, print which image and which probe failed plus the module's own error
   line, and abort via `_fail_deploy` so `.deploy-status.json` reaches `failed`.
5. No-op fast: if `imageArchProbes` is empty or no built service declares a
   probe, print one line and return without invoking Docker at all.
6. Write `scripts/lib/image-arch-check.test.sh` and register it in `test:hooks`.
7. Two-way validation against real artifacts (see acceptance criteria).

## Files involved
- new file: `scripts/lib/image-arch-check.sh` — probe kinds + runner
- new file: `scripts/lib/image-arch-check.test.sh` — registered in `test:hooks`
- `scripts/lib/pre-push-config.sh` — read `ci.imageArchProbes`
- `scripts/hooks/pre-push` — call the guard after the build fan-out, before deploy
- `package.json` — add the new test file to `test:hooks`
- `docs/CROSS-PLATFORM-BUILD-PATTERN.md` — document the config key and that the
  guard is enforced, not advisory

## Acceptance criteria
- [ ] **Two-way validated against real artifacts.** Run the probes against
      tastease release **1174 (must pass all three)** and **1247 (must fail all
      three)**. Record both outputs in the sprint report. A guard only ever
      exercised against good input proves nothing — that is exactly how this bug
      shipped. **Do not `docker pull` these from GHCR** — see "Preserved
      reference artifacts" in Context; `api:1174` and `api:1174-migrate` were
      pruned from the registry on 2026-09-13 and exist only locally now.
- [ ] A failing probe aborts before the deploy step runs, and
      `.deploy-status.json` ends at `failed` (not stuck at `deploying`)
- [ ] The failure message names the image, the probe, and the module's own error
      (e.g. `needs the "@esbuild/linux-x64" package instead`)
- [ ] A project with no `imageArchProbes` runs no Docker commands and adds no
      measurable time — verify against a project whose `.emit-infra.json` omits
      the key
- [ ] Probes load the module; the suite includes a case proving a
      presence-style check would have passed where the load-based probe fails
- [ ] Test coverage in `scripts/lib/image-arch-check.test.sh`, registered in
      `test:hooks`
- [ ] `pnpm test:hooks` passes (this repo has no `check:affected`; shell libs are
      covered by that suite)

## Out of scope
- Restructuring `build_image` to `--load` then push separately, so a bad image
  never reaches GHCR at all. Defensible, but it changes caching and build
  parallelism for every project — file it as a follow-up if the guard proves out.
- Declaring probes in any project's `.emit-infra.json` (sprint 327 for tastease,
  sprint 328 for develemail and diner-decider).
- Fixing `supportedArchitectures` placement in other repos — sprint 328.
- Multi-arch manifests, or building natively on an x64 machine.
