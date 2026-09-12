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
- [ ] The deployed build is confirmed live independently of
      `.deploy-status.json`: API `uptime` reset and a fresh `release` number on
      prod events
- [ ] The shared guard reproduces the reference results: release 1174 passes all
      three probes, release 1247 fails all three — using the locally preserved
      artifacts, not a registry pull
- [ ] The `-migrate` build variant is probed, not just the `api` service image —
      state in the report how this was confirmed
- [ ] No local copy remains: `scripts/check-image-arch.sh` and its package.json
      entry are gone, and no tastease doc still tells a human to run it manually
- [ ] `pnpm test:hooks` passes in emit-infra, and `pnpm check:affected` passes in
      tastease (its `.emit-infra.json`, `package.json` and docs changed)

## Out of scope
- Changing tastease's Dockerfiles. They are correct as of `c3e0744`; the stale
  `docs/PRE-PUSH-HOOK.md#cross-platform-build-pattern` anchor in their headers is
  a separate filed item, and touching a Dockerfile forces all three images to
  rebuild.
- develemail and diner-decider — sprint 328.
- The `deploy-detached.sh` bugs this sprint has to work around — sprint 329.
- Re-testing tastease's application behaviour; build 1248 is already verified.
