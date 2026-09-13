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
- [x] Discovery produces all 21 fleet images, including the 11 listed above;
      quote the resolved list in the report
- [x] tastease resolves to `easyliving/*` and develemail to `develemail-*` —
      proving the `imagePrefix` vs `ghcrRepo` branch is honoured, not guessed
- [x] Build variants (`-migrate`) add no extra package
- [x] A project with an unparseable config or no services is skipped with a
      warning and does not abort the run
- [x] Any name in the old hardcoded array that discovery does not produce is
      reported, not silently dropped
- [x] `--dry-run` over the full discovered list completes and its per-image
      counts are recorded, with newly covered images called out separately
- [x] Sprint 330's guarantee still holds under discovery: no deployed release is
      selected for deletion anywhere in the fleet
- [x] Coverage for all of the above in `scripts/lib/ghcr-prune.test.sh`
- [x] `pnpm test:hooks` passes (this repo has no `check:affected`)

## Out of scope
- The retention rules themselves — sprint 330 owns the deployed-release
  exemption and budget accounting; this sprint only changes *which* images
  those rules apply to.
- Actually deleting the backlog of versions on newly covered images. Surface the
  numbers; let a human approve the first real prune.
- Pruning any registry other than GHCR, or server-side image retention.
- Adding a "project is retired, stop pruning it" concept.

## Completed

**Date:** 2026-09-12

### Summary
`ghcr-prune.sh`'s `PACKAGES` array is gone. `scripts/lib/ghcr-prune-lib.sh`
gained `_ghcrprune_discover_packages`, which walks every
`~/projects/*/.emit-infra.json`, reads `ci.ghcrOrg`, `ci.ghcrRepo` (falling
back to the last path segment of `github.repo`, mirroring
`pre-push-config.sh:34`), `ci.imagePrefix`, and `blueGreen.services[].name`,
and derives each service's GHCR package path by calling `image_name()`
(sourced from `docker-build.sh`) with those values injected as a per-call
env-var prefix — so naming can never drift from what the build actually
pushes, the exact risk the sprint's Reason section called out. `ghcr-prune.sh`
now prints the resolved package list at the top of every run and keeps a
`--packages a,b,c` escape hatch for one-off runs.

Discovery is deliberately per-project-conservative: a config that fails to
parse, has no `ci.ghcrOrg`, or declares no `blueGreen.services` is skipped
with a warning on stderr and the rest of the fleet still gets discovered —
never treated as "nothing to keep" and never aborts the whole run. Live
against the real fleet this produces exactly the 21 images the sprint's
Reason table predicted: the original 10 plus 11 new (`develemail-inbound`,
both `diner-decider-*`, all three `emit-billing-*`, both `emit-social-*`, and
all three `martialops-*`). `test-smoke` (no `ci.ghcrOrg`, no services) is
skipped with a warning, as designed. A manual reconciliation (`comm` between
the old hardcoded array and live discovery output) confirmed zero stale names
— every entry in the old array is still produced by discovery, so nothing was
silently dropped.

Owner scoping stays intentionally minimal per the sprint's guidance: discovery
emits `<owner>\t<package>` pairs, and `ghcr-prune.sh` loudly warns and skips
any package whose owner doesn't match the configured `GHCR_OWNER` rather than
building multi-BASE resolution machinery for a case (a second GHCR org) that
doesn't exist in the fleet yet. Every project today resolves to `develemit`,
so this path is untested by the live run but exercised by nothing silently
disappearing if it ever triggers.

One correctness fix along the way: with the hardcoded array gone, `PACKAGES`
can legitimately end up empty (bad `PROJECTS_DIR`, a `--packages ""`, or a
fleet where every project fails discovery). Bash 3.2 — the version this
machine's `bash` and the launchd job's `PATH` resolve to — throws "unbound
variable" on `"${arr[@]}"` for a *declared-but-empty* array under `set -u`,
which every downstream `for pkg in "${PACKAGES[@]}"` and `printf` would have
hit. Added an explicit `${#PACKAGES[@]} -eq 0` guard that refuses loudly
before either point, verified against this machine's actual bash 3.2.

### Files changed
- `scripts/ghcr-prune.sh` — hardcoded `PACKAGES` array replaced with
  discovery (falls back to `--packages` override), prints the resolved list,
  refuses to run on zero resolved packages
- `scripts/lib/ghcr-prune-lib.sh` — (new) `_ghcrprune_parse_project_config`,
  `_ghcrprune_discover_packages`; sources `docker-build.sh` for `image_name()`
- `scripts/lib/ghcr-prune.test.sh` — 8 new fixture-driven cases: prefix-style
  naming, repo-style naming (tastease's shape), `ghcrRepo` falling back to
  `github.repo`, build variants adding no extra package, a project with no
  `blueGreen.services`, and an unparseable config — all skip-with-warning
  without aborting the rest of discovery

### Verification
- `pnpm test:hooks`: full suite, all 15 registered files (this repo has no
  `check:affected`), 354/354 pass (`ghcr-prune.test.sh` itself: 31/31, up
  from 23/23 before this sprint)
- Live `_ghcrprune_discover_packages ~/projects`: resolves exactly 21
  packages across `develemail`, `diner-decider`, `emit-billing`,
  `emit-social`, `emit-vision`, `martialops`, and `tastease`; `test-smoke` is
  skipped with a printed warning (no `ci.ghcrOrg`, no services) and does not
  abort the run
- `bash scripts/ghcr-prune.sh --dry-run`: completes over the full discovered
  list, reports 1126 versions across 21 images (up from 974 across the old
  10), with per-image counts printed for the newly covered images
  (`develemail-inbound`: 4, `diner-decider-web`: 60, `diner-decider-api`: 61,
  `emit-billing-*`: 0 each, `emit-social-web`: 0, `emit-social-api`: 2,
  `martialops-web`: 9, `martialops-api`: 8, `martialops-marketing-web`: 8)
- `bash scripts/ghcr-prune.sh --packages a,b --dry-run`: override path
  restricts the run to exactly the given packages
- Reconciliation: `comm` between the old 10-entry array and live discovery
  output shows zero old names missing from discovery and exactly the 11
  predicted new entries added
- Sprint 330's guarantee re-verified against a newly covered image: real
  selection against `martialops-api`'s live version list (fleet-wide 7
  protected deployed shas) selected 8 ids for pruning and did not select the
  currently-deployed version (id `1226587088`, tagged `826` /
  `412710c4b52c8031f832b99d9800ee744541f796` / `latest`)
- No live DELETE calls were made during this session's work

### Follow-ups
- `[defer]` The newly covered images (`develemail-inbound`,
  `diner-decider-*`, `emit-billing-*`, `emit-social-*`, `martialops-*`) have
  never been pruned and some carry a real backlog (`diner-decider-web`: 60,
  `diner-decider-api`: 61 versions eligible today). Per this sprint's scope, a
  human should review the `--dry-run` output before the first live prune
  touches them.
- `[defer]` Multi-owner discovery (a package whose `ci.ghcrOrg` differs from
  the configured `GHCR_OWNER`) is loudly skipped rather than supported —
  untested against a real second org since none exists in the fleet yet.
- `[defer]` Live-deletion verification (a real non-dry-run prune) is still
  pending the user's decision on granting `delete:packages` to the `gh`
  credential this script and the launchd job use — unchanged from sprints 330
  and 330.1.
- `[defer]` `com.emit.ghcr-prune` remains unloaded by design; re-bootstrap it
  once the user is satisfied with the discovered package list and the
  newly-covered backlog above.
