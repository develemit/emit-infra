# Derive the prune's image list from fleet config instead of hardcoding it
**Difficulty:** 3

## Goal
`ghcr-prune.sh` discovers which GHCR images to manage by reading the fleet's
own `.emit-infra.json` files, so a new project or service is covered the day it
ships — and no image is silently left to grow forever.

## Reason
The package list is a hardcoded array that has drifted badly from the fleet it
is supposed to manage. Verified 2026-09-12 against every project's
`.emit-infra.json`:

```
PACKAGES=(
  develemail-web develemail-api develemail-worker
  "easyliving/api" "easyliving/web" "easyliving/marketing"
  emit-api emit-worker emit-web emit-marketing
)
```

That is 10 images. The fleet actually publishes **21**. Missing entirely:

| Project | Uncovered images |
|---|---|
| diner-decider | `diner-decider-web`, `diner-decider-api` |
| emit-billing | `emit-billing-web`, `emit-billing-api`, `emit-billing-worker` |
| emit-social | `emit-social-web`, `emit-social-api` |
| martialops | `martialops-web`, `martialops-api`, `martialops-marketing-web` |
| develemail | `develemail-inbound` (the other three are listed) |

So the prune is simultaneously too aggressive where it applies (sprint 330) and
absent for **half the fleet**, whose images accumulate without bound. Both
failures share one root cause: the list is maintained by hand and nothing
notices when it goes stale. Every project added since the list was written has
been invisible to it, and the next one will be too.

## Context

### Image naming is already solved — reuse it, don't re-derive it
`scripts/lib/docker-build.sh:10-17` is the single source of truth:

```bash
image_name() {
  local svc="$1"
  if [[ -n "$IMAGE_PREFIX" ]]; then
    echo "ghcr.io/$GHCR_ORG/${IMAGE_PREFIX}${svc}"
  elif [[ -n "$GHCR_REPO" ]]; then
    echo "ghcr.io/$GHCR_ORG/$GHCR_REPO/$svc"
  else
    echo "ghcr.io/$GHCR_ORG/$svc"
  fi
}
```

That is exactly why tastease's images are `easyliving/api` (no `imagePrefix`,
`ghcrRepo: easyliving`) while develemail's are `develemail-api` (prefix set).
**Any reimplementation of this rule will drift the same way the array did** —
source the existing helper, or move `image_name()` somewhere both callers share.
The prune needs the path *after* `ghcr.io/<owner>/`, which is what the GHCR API
takes as the (url-encoded) package name.

### Where the inputs come from
Per project `.emit-infra.json`: `ci.ghcrOrg`, `ci.ghcrRepo` (falling back to the
last path segment of `github.repo`), `ci.imagePrefix`, and the service list at
`blueGreen.services[].name`. `scripts/lib/pre-push-config.sh:16-45` already
parses all of these — read it for the exact fallback semantics rather than
guessing. Iterate the fleet the way `scripts/collect-metrics.sh:146` does.

Note **build variants do not add packages**: tastease's `-migrate` image is a
tag suffix on `easyliving/api` (`ci.buildVariants`), not a separate package.
Enumerate services, not variants.

### Owner scoping
Every project today uses `ghcrOrg: develemit`, and the script resolves org-vs-user
once via `gh api /orgs/$GHCR_OWNER`. Group discovered images by their owner so a
future project under a different org doesn't quietly get skipped — but don't
build elaborate multi-owner machinery for a case that doesn't exist yet.

### Safety
Discovery must be **additive and conservative**. A project whose config can't be
parsed, or that declares no services, is skipped with a printed warning — never
treated as "nothing to keep". And since this sprint widens what the prune touches
for the first time in a long time, the first run against the newly covered images
must be a `--dry-run` that a human reads before anything is deleted.

### Conventions
Shell libs live in `scripts/lib/<name>.sh` with a sibling `<name>.test.sh`
registered in the root `package.json`'s `test:hooks`. Sprint 330 creates
`scripts/lib/ghcr-prune-lib.sh` and `ghcr-prune.test.sh` — **extend those rather
than adding a third file**. There is no `check:affected` in this repo;
`pnpm test:hooks` is the suite.

## Tasks
1. Add fleet discovery to `scripts/lib/ghcr-prune-lib.sh`: walk
   `~/projects/*/.emit-infra.json` and emit the GHCR package path for every
   declared service, reusing `image_name()`'s rule rather than restating it.
2. Replace the hardcoded `PACKAGES` array with discovery. Keep a
   `--packages <a,b,c>` override for one-off runs, and print the resolved list
   at the start of every run so drift is visible in the log.
3. Skip unparseable or service-less projects with a warning; never fail the
   whole run on one bad config.
4. Reconcile discovery against the current hardcoded list and **report the
   difference explicitly** — the 11 newly covered images above, plus anything in
   the old array that discovery does not produce (a stale name is a finding, not
   something to silently drop).
5. Extend `scripts/lib/ghcr-prune.test.sh` with fixture-based cases: prefix-style
   naming, repo-style naming (tastease), `ghcrRepo` falling back to `github.repo`,
   a project missing `blueGreen.services`, an unparseable config, and that build
   variants add no extra package.
6. Run `--dry-run` across the full discovered list and record per-image counts in
   the report — especially for the newly covered images, which may have years of
   accumulated versions. Do not do a live prune of newly covered images in this
   sprint without stating what it would delete first.

## Files involved
- `scripts/ghcr-prune.sh` — discovery replaces the hardcoded array; `--packages` override
- `scripts/lib/ghcr-prune-lib.sh` — discovery helper (created by sprint 330)
- `scripts/lib/docker-build.sh` — source of `image_name()`; share it rather than duplicating
- `scripts/lib/ghcr-prune.test.sh` — new discovery cases
- `package.json` — only if a new test file proves necessary

## Acceptance criteria
- [ ] Discovery produces all 21 fleet images, including the 11 listed above;
      quote the resolved list in the report
- [ ] tastease resolves to `easyliving/*` and develemail to `develemail-*` —
      proving the `imagePrefix` vs `ghcrRepo` branch is honoured, not guessed
- [ ] Build variants (`-migrate`) add no extra package
- [ ] A project with an unparseable config or no services is skipped with a
      warning and does not abort the run
- [ ] Any name in the old hardcoded array that discovery does not produce is
      reported, not silently dropped
- [ ] `--dry-run` over the full discovered list completes and its per-image
      counts are recorded, with newly covered images called out separately
- [ ] Sprint 330's guarantee still holds under discovery: no deployed release is
      selected for deletion anywhere in the fleet
- [ ] Coverage for all of the above in `scripts/lib/ghcr-prune.test.sh`
- [ ] `pnpm test:hooks` passes (this repo has no `check:affected`)

## Out of scope
- The retention rules themselves — sprint 330 owns the deployed-release
  exemption and budget accounting; this sprint only changes *which* images
  those rules apply to.
- Actually deleting the backlog of versions on newly covered images. Surface the
  numbers; let a human approve the first real prune.
- Pruning any registry other than GHCR, or server-side image retention.
- Adding a "project is retired, stop pruning it" concept.
