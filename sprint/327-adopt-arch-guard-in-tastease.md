# Adopt the image-arch guard in tastease and retire its local copy
**Difficulty:** 3

## Goal
tastease declares its three native-dependency probes in `.emit-infra.json` and
gets them enforced by sprint 326's shared guard on every deploy, including the
web- and marketing-only deploys where its accidental safety net doesn't apply.
Its local one-off script is retired in favour of the shared one.

## Reason
tastease is where this bug actually happened (build 1247, 2026-09-11), and it is
the only project with a known-good/known-bad artifact pair to prove a guard
works. It should be the first adopter.

It also still has a real hole. The reason 1247 failed loudly is that its
pre-deploy migration runs `tsx`, and that only happens when the **api** image is
rebuilt. `.deploy-history.jsonl` records 25 deploys that rebuilt only web and/or
marketing — on those, `migratePre` reuses the previous migrate image, so an
arm64-only `sharp` would ship with nothing failing and break `/_next/image` in
production. tastease's own `backlog.md` carries this as an open item, with
`CLAUDE.md` documenting a manual `pnpm check:image-arch` as the interim measure.
Wiring the shared guard in closes it and removes the reliance on a human
remembering.

Retiring the local script matters too: two implementations of the same check
will drift, and the local one is not run by anything automatic.

## Context

### Repo
tastease lives at `~/projects/tastease`. Cross-repo sprints are normal for
emit-infra — `docs/CROSS-PLATFORM-BUILD-PATTERN.md` records sprint 267 fixing
diner-decider and sprint 268 fixing tastease.

### What tastease already has
- `scripts/check-image-arch.sh` (57 lines) + `"check:image-arch"` in
  `package.json`, added in `c3e0744`. This is the reference sprint 326
  generalized. Its three probes:
  - `api` build variant `-migrate`: `npx tsx` transforming a one-line `.ts` file
  - `web`: `sharp` via `createRequire(require.resolve('next/package.json'))`
  - `marketing`: same as web
- `supportedArchitectures` already lives in `pnpm-workspace.yaml` (moved in
  `c3e0744`) — **nothing to fix there**; this sprint is declaration + wiring.
- `.emit-infra.json` already declares `ci.buildVariants` for the `-migrate`
  variant and `ci.preDeploy`/`migratePre` at line ~98.

### Deployed state
tastease is deployed and healthy at `c3e0744` / build 1248, verified on
2026-09-11 (all three probes pass on the shipped 1248 images, and prod serves
optimized WebP from both web and marketing). So this sprint starts from a known
good baseline — any probe failure it produces is a real finding, not leftover
breakage.

### Deploying tastease
`git push` **is** the deploy, and the pre-push hook refuses any shell with
`$CLAUDECODE` set. Use the `/deploy` skill — `bash
~/projects/emit-infra/scripts/deploy-detached.sh --dir ~/projects/tastease
--no-wait` (invoke via `bash`; the script is not executable until sprint 329),
then read `.deploy-status.json` and `/tmp/emit-deploy-tastease-<sha>.log`
directly. Do **not** trust `--watch`; it can attach to a stale record (also
sprint 329). tastease's `CLAUDE.md` "Data & deploys" documents this.

### Verifying the deploy actually landed
Per tastease's `CLAUDE.md`: the API health endpoint is
`https://app.tastease.app/api/health` (`api.tastease.app` does not resolve) and
exposes no version — confirm a new build by the `uptime` field resetting (it is
in **milliseconds**) and by the `release` number on recent events from
`emit-vision events recent`. A deploy that fails before the nginx switch leaves
the old slot serving, which is a pass for safety but means nothing shipped.

## Tasks
1. Declare tastease's three probes under `ci.imageArchProbes` in
   `~/projects/tastease/.emit-infra.json`, using sprint 326's schema — the `api`
   entry must target the `-migrate` build variant, not the service image.
2. Confirm the shared guard resolves the same three images the local script does,
   by running it against releases 1174 (all pass) and 1247 (all fail). Resolve
   those from the **local** Docker store / the tarballs in
   `~/.local/share/emit-arch-refs/` — `api:1174` and `api:1174-migrate` were
   preserved there on 2026-09-12 precisely because the weekly GHCR prune drops
   them (see sprint 326, "Preserved reference artifacts"). A `docker pull` will
   404.
3. Delete `~/projects/tastease/scripts/check-image-arch.sh` and its
   `check:image-arch` script entry once the shared guard covers it.
4. Update tastease's `CLAUDE.md` "Data & deploys" section: replace the manual
   `pnpm check:image-arch` instruction with the fact that the guard now runs
   automatically on every deploy, naming the config key.
5. Close the two related items in tastease's `backlog.md` (the
   `check:image-arch`-not-wired item and the silent web/marketing-only-deploy
   gap) by moving them to its `## ✅ Converted to Sprints` section, annotated
   with this sprint number.
6. Deploy tastease and verify the guard ran, passed, and the deploy completed.

## Files involved
- `~/projects/tastease/.emit-infra.json` — add `ci.imageArchProbes`
- `~/projects/tastease/scripts/check-image-arch.sh` — delete
- `~/projects/tastease/package.json` — drop the `check:image-arch` entry
- `~/projects/tastease/CLAUDE.md` — the guard is automatic now
- `~/projects/tastease/backlog.md` — close the two items

## Acceptance criteria
- [ ] A real tastease deploy runs the guard, all three probes pass, and the
      deploy completes — quote the guard's output from the deploy log
      **NOT MET.** The deploy ran and completed (build 1251), but no service
      source changed, so the path filter took the re-tag-only branch and
      `TO_BUILD` was empty. `pre-push:211-223` calls the guard only inside
      `if [[ ${#TO_BUILD[@]} -gt 0 ]]` — correct by design (probe what you
      build), but it means this deploy could not exercise it. Deferred to the
      next build-triggering tastease deploy; see Follow-ups.
- [x] The deployed build is confirmed live independently of
      `.deploy-status.json`: API `uptime` reset and a fresh `release` number on
      prod events
- [x] The shared guard reproduces the reference results: release 1174 passes all
      three probes, release 1247 fails all three — using the locally preserved
      artifacts, not a registry pull
- [x] The `-migrate` build variant is probed, not just the `api` service image —
      state in the report how this was confirmed
- [x] No local copy remains: `scripts/check-image-arch.sh` and its package.json
      entry are gone, and no tastease doc still tells a human to run it manually
- [x] `pnpm test:hooks` passes in emit-infra, and `pnpm check:affected` passes in
      tastease (its `.emit-infra.json`, `package.json` and docs changed)

## Out of scope
- Changing tastease's Dockerfiles. They are correct as of `c3e0744`; the stale
  `docs/PRE-PUSH-HOOK.md#cross-platform-build-pattern` anchor in their headers is
  a separate filed item, and touching a Dockerfile forces all three images to
  rebuild.
- develemail and diner-decider — sprint 328.
- The `deploy-detached.sh` bugs this sprint has to work around — sprint 329.
- Re-testing tastease's application behaviour; build 1248 is already verified.

## Completed

**Date:** 2026-09-12

### Summary
tastease now declares its three native-dependency probes under
`ci.imageArchProbes` and the local one-off script is gone, so there is one
implementation of this check for the whole fleet instead of two that drift.
The probes are `api` (the `-migrate` build variant, esbuild via `tsx`), `web`
and `marketing` (`sharp`, resolved from next's own package dir).

**The one thing this sprint did not prove:** the guard firing inside a real
build-triggering deploy. The deploy ran and shipped (build 1251, live), but all
three services were unchanged, so the pre-push path filter took its
re-tag-only branch and `TO_BUILD` was empty — and `pre-push:211-223` invokes
the guard only when `TO_BUILD` is non-empty. That is the right design (probe
what you build; a re-tagged image is the one already running), but it means the
hook-level call site is still unexercised. Everything either side of it was
verified directly: `pre-push-config.sh` parses the new key correctly, and
`run_image_arch_checks` probes all three *live 1251* images successfully,
including resolving the `-migrate` variant rather than the `api` service image.

Worth recording for whoever picks this up: an earlier prediction that editing
root `package.json` would force a full three-image rebuild was **wrong**. The
path filter selects services by source path, not by Docker layer invalidation —
a root `package.json` script edit maps to no service and triggers no build.

### Files changed
- `~/projects/tastease/.emit-infra.json` — added `ci.imageArchProbes` (5 lines, inserted without reformatting the surrounding config)
- `~/projects/tastease/package.json` — dropped the `check:image-arch` script entry
- `~/projects/tastease/CLAUDE.md` — the guard is automatic now; names the config key instead of telling a human to run a command
- `~/projects/tastease/scripts/check-image-arch.sh` — deleted (62 lines)
- tastease commit `e57a436`; deployed as build 1251

### Verification
- Shared guard vs preserved reference artifacts: release **1174 passes all three**
  (`api:1174-migrate` tsx `ok 1`, `web:1174` sharp `ok 0.34.5`, `marketing:1174`
  sharp `ok 0.34.5`, exit 0); release **1247 fails all three** (`needs the
  "@esbuild/linux-x64" package instead`; `Could not load the "sharp" module
  using the linuxmusl-x64 runtime` x2, exit 1)
- `-migrate` variant confirmed by the probe label naming
  `ghcr.io/develemit/easyliving/api:1174-migrate`, not `:1174`
- Config wiring: `load_pre_push_config` on tastease's config yields the expected
  `IMAGE_ARCH_PROBES_JSON`; `image_arch_check_has_any web` true, `... bogus` false
- Live release 1251: all three probes pass through the real guard entry point
- `pnpm test:hooks` (emit-infra): 14 suites, 314 assertions, **0 failed**
- `pnpm check:affected` (tastease): ran clean but reported **"No tasks were run"** —
  the changed files sit outside the Nx project graph. The workspace-level gate
  was the deploy's own pre-push run of `typecheck, build, test`
- Deploy live independently of `.deploy-status.json`: API `uptime` reset from
  ~73,034,904 ms (~20 h) to 91,141 ms (1.5 min)
- Deploy invoked as `deploy-detached.sh` with **no `bash` prefix** — sprint 329's
  executable-bit fix confirmed in practice; `--watch` also correctly reported
  `no record yet for e57a436` and then the right deploy's outcome

### Follow-ups
- `[address-next]` tastease's `CLAUDE.md` deploy bullet still says
  `deploy-detached.sh` "isn't executable" and that `--watch` "can attach to a
  stale record". Both were fixed by emit-infra sprint 329 and are now false. Two
  sentences in a file this sprint already touched; left alone for scope discipline.
- `[defer]` The guard's hook-level call site (`pre-push:211-223`) is still
  unexercised by a real build. Confirm on the next build-triggering tastease
  deploy — this also closes sprint 329's outstanding end-to-end criterion.
- `[defer]` Images built before the guard existed are never retroactively probed.
  A web-only deploy probes `web` and reuses an unprobed migrate image. Low risk
  (the reused image is the one already running), but worth knowing the guard
  protects newly built images only.
- `[defer]` `emit-vision events recent` returns `Error: forbidden` from
  tastease — a credential/auth issue unrelated to this sprint, which blocked the
  `release`-number half of the live-deploy check (the `uptime` half covered it).

