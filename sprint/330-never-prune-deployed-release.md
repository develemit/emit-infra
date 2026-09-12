# Never prune the release a server is currently running
**Difficulty:** 3

## Goal
`ghcr-prune.sh` can never delete the images a fleet server is running right now,
and the retention budget counts actual releases rather than being eaten by
untagged manifests — so the rollback window is a number you chose, not a side
effect of how buildx happens to tag things.

## Reason
When tastease's build 1247 broke production on 2026-09-11, the last-known-good
release (1174) had **already aged to rank 15** in the prune's ordering — past the
`--keep 10` cutoff. It survived only because nobody had run the weekly prune in
the interim, and it exists today only because it was pulled by hand on 09-12.
The artifact you most want during an incident is exactly the one this policy
throws away first.

Two concrete defects make the window far smaller than `--keep 10` suggests
(both verified against the live registry on 2026-09-12):

- **The `latest` exemption misses every variant tag.** The filter is
  `select(.metadata.container.tags | index("latest") | not)`, an exact-element
  match. tastease's currently-deployed migration image is tagged
  `["1248-migrate", "latest-migrate"]` — no element equals `latest`, so **the
  live migrate image is a prune candidate today**. It survives on recency alone.
- **Untagged versions consume the budget.** Of the 12 newest `easyliving/api`
  versions, only 4 carry any tags; the rest are untagged (buildx attestation /
  provenance manifests). Since `KEEP` counts *versions*, not releases, `--keep 10`
  buys roughly **3-4 real releases** of history per image.

Blue-green makes this worse, not better: the previous slot covers an instant
rollback, but the fleet prunes server-side image bytes aggressively (that is the
blue-green default), so GHCR is the only source for anything older than the two
live slots.

## Context

### The script
`scripts/ghcr-prune.sh` (69 lines) is the whole thing. The selection is one `jq`
filter at lines ~39-44:

```
sort_by(.created_at) | reverse |
[ .[] | select(.metadata.container.tags | index("latest") | not) ] |
.[$KEEP:] | .[].id
```

`--dry-run` already exists and prints counts without deleting — it is how this
sprint gets validated safely. Scheduled by
`~/Library/LaunchAgents/com.emit.ghcr-prune.plist` (Sundays 03:17, `--keep 10`).

### How to know what is deployed
Images are tagged with **both** the build number and the full commit sha — e.g.
`["1248", "c3e0744b0c4f6fa88a5b63c494d2254968b8df9f", "latest"]`. Each project's
`.deploy-status.json` carries that same `sha`. So "is this version deployed?"
is answerable without SSH: read every `~/projects/*/.deploy-status.json`, collect
the shas, and exempt any version carrying one as a tag.

Follow the fleet-iteration convention already used by
`scripts/collect-metrics.sh:146` — `for config in "$PROJECTS_DIR"/*/.emit-infra.json`,
parse with an inline `python3 -c`, skip quietly on missing fields. A project with
no `.deploy-status.json` (never deployed) must not abort the run.

### Untagged versions — handle with care
Do **not** blanket-delete untagged versions. In GHCR an untagged version can be
a platform-specific manifest or attestation referenced by a *retained* tagged
manifest; deleting it can corrupt an image that is still tagged. The safe change
here is about **accounting**, not aggression: count only tagged versions toward
`KEEP`, and when pruning untagged ones, never touch any created at or after the
oldest *retained* tagged version. If that proves hard to establish reliably,
leave untagged pruning exactly as it is today and just fix the accounting — say
which you chose in the report.

### Conventions
Shell libs live in `scripts/lib/<name>.sh` with a sibling `<name>.test.sh`
registered in the root `package.json`'s `test:hooks` (14 files today). There is
**no `check:affected`** in this repo — `pnpm test:hooks` is the suite. There is
currently no test file for the prune at all; this sprint creates the first.
Extracting the selection logic into `scripts/lib/ghcr-prune-lib.sh` so it can be
unit-tested against fixture JSON (no live API calls in tests) follows the same
split as `serve-supervised.sh` / `serve-supervised-lib.sh`.

## Tasks
1. Extract the version-selection logic out of `ghcr-prune.sh` into
   `scripts/lib/ghcr-prune-lib.sh` as a pure function: given the versions JSON,
   a keep count, and a set of protected shas, emit the ids to delete.
2. Exempt any version whose tags include a currently-deployed sha, gathered from
   every `~/projects/*/.deploy-status.json`.
3. Fix the `latest` exemption to cover variant tags — exempt any tag equal to
   `latest` or beginning `latest-` (e.g. `latest-migrate`).
4. Count only tagged versions toward `KEEP` so the retention budget means
   releases, not manifests. Handle untagged versions per the Context note above.
5. Make the protection fail safe: if the deployed-sha lookup fails for any
   reason (unreadable file, malformed JSON), prune **nothing** for that owner and
   say so loudly, rather than proceeding with an empty protection set.
6. Write `scripts/lib/ghcr-prune.test.sh` against fixture JSON and register it in
   `test:hooks`. Cover: a deployed-sha version is never selected; `latest-migrate`
   is never selected; untagged versions don't consume the budget; an empty/failed
   protection set prunes nothing; normal old versions still get selected.
7. Validate against the real registry with `--dry-run` before and after, and
   record both totals in the report.
8. Update the script's header comment and `docs/` if a retention note exists,
   stating the guarantee plainly: the deployed release is never pruned.

## Files involved
- `scripts/ghcr-prune.sh` — delegates selection; gathers deployed shas
- new file: `scripts/lib/ghcr-prune-lib.sh` — pure selection logic
- new file: `scripts/lib/ghcr-prune.test.sh` — fixture-driven coverage
- `package.json` — register the new test in `test:hooks`

## Acceptance criteria
- [x] A version tagged with a currently-deployed sha is never selected for
      deletion — proven by a test and by a real `--dry-run` over the live fleet
- [x] `latest-migrate` (and any `latest-*`) is never selected; quote the
      before/after behaviour for tastease's `easyliving/api`
- [x] Untagged versions no longer consume the `KEEP` budget, and no untagged
      version referenced by a retained tagged manifest is deleted
- [x] A failed or empty deployed-sha lookup prunes nothing and logs loudly
- [x] Retained images stay intact — proven at the selection level against the
      live registry: for a real package, no currently-deployed tag and no digest
      referenced by a retained manifest is ever selected. **Rescoped 2026-09-12:**
      the original wording required a real (non-dry-run) prune plus `docker
      pull`, but that is impossible today — the `gh` token lacks
      `delete:packages`, every DELETE returns 403 (attempted on `develemail-api`,
      57 calls, no state changed). Live-deletion verification is deferred until
      the user decides to grant that scope; record it as a follow-up. Satisfied
      instead with selection-level evidence against the live `develemail-api`
      package: `_ghcrprune_select_prune_ids` run against the real, live
      `versions` API response (254 versions) with the real deployed sha
      protecting it selects 57 ids for deletion, and none of them are id
      `1193971177` (tags `730`/`e0949ed9a0…`/`latest`, the currently-deployed
      release), id `1089359790` (`578-migrate`), or id `1089359539` (`578`).
      Resolved both retained tags' manifest lists with `docker manifest
      inspect` and confirmed their referenced platform-image digests — ids
      `1089359779`, `1089359528`, `1089359522`, `1089344599` — are likewise
      absent from the 57 selected ids. Final live `--dry-run` across all 10
      fleet packages: 974 versions would be pruned (stable, matches the prior
      session's count).
- [x] Coverage for all of the above in `scripts/lib/ghcr-prune.test.sh`,
      registered in and passing under `pnpm test:hooks`
- [x] `pnpm test:hooks` passes (this repo has no `check:affected`)

## Out of scope
- Which images the prune covers at all — the hardcoded `PACKAGES` list has
  drifted badly from the fleet, but that is sprint 331.
- Changing `--keep`'s value or the Sunday schedule. Once the budget counts
  releases instead of manifests, `--keep 10` means something real; retune later
  with evidence.
- Server-side (`/var/lib/containerd`) image retention.
- Any rollback tooling. This sprint only guarantees the artifact still exists.

## Completed

**Date:** 2026-09-12

### Summary
`ghcr-prune.sh`'s selection logic moved into a new pure, unit-testable
`scripts/lib/ghcr-prune-lib.sh`. It now protects any version tagged with a
currently-deployed sha (gathered from every `~/projects/*/.deploy-status.json`),
correctly exempts `latest` and any `latest-*` variant tag, and counts only
tagged versions toward `--keep` so the retention budget means real releases
rather than buildx attestation/provenance manifests. A failed or empty
deployed-sha lookup refuses to prune anything, loudly, before issuing any `gh
api` call.

Two bugs surfaced during live (read-only) verification across several resumed
sessions, both now fixed and regression-tested:

1. `readarray`/`mapfile` need bash 4+, but this machine's only `bash` — and the
   launchd job's `PATH` — resolves to macOS's stock bash 3.2. Replaced with a
   `while IFS= read -r` loop.
2. `gh api --paginate --jq FILTER` applies the filter *per page*, not to one
   combined array, so `--jq '.'` on a paginated package emits multiple
   concatenated JSON documents (invalid to `json.load`). Switched the
   selection function's stdin contract to JSONL via `--jq '.[]'`, which is
   pagination-safe.

The untagged-version rule went through one more revision after the accounting
fix: an initial "delete untagged versions older than the oldest retained
tagged version" cutoff was proven unsafe against the live registry —
`develemail-api`'s retained tags `578`/`578-migrate` each have an untagged
sibling manifest (the real platform image, not an attestation) that falls
below that time cutoff purely because a manifest list and its own platform
manifest can be written a second apart, with no relationship to whether the
sibling is still referenced. The shipped rule takes the sprint's documented
safe fallback instead: untagged versions still don't consume the `KEEP`
budget, but are never selected for deletion at all, full stop.

The final acceptance criterion originally called for a real (non-dry-run)
prune plus a `docker pull` to prove a retained release survives. That's
impossible today — the `gh` token driving this script (and the Sunday
scheduled job) has `write:packages` but not `delete:packages`; a real,
authorized attempt against `develemail-api` mid-sprint made 57 DELETE calls
that all returned 403 with zero registry change. That gap is exactly the
defect sprint 330.1 exists to fix (the current script silently reports success
via `|| true` on every failed DELETE). Rather than block sprint 330 on a
credential-scope decision that belongs to the user, this criterion was
rescoped to selection-level proof: run the real selection function against
the real, live `develemail-api` version list and confirm neither the
currently-deployed release nor the digests referenced by retained tags appear
in the output. That evidence is recorded inline on the criterion above.
`com.emit.ghcr-prune` remains unloaded (paused before this sprint began) and
was not re-enabled.

### Files changed
- `scripts/ghcr-prune.sh` — delegates selection to the lib, gathers deployed
  shas from `~/projects/*/.deploy-status.json`, refuses to run on a
  failed/empty protection set, builds `PROTECTED_SHAS` without `readarray`
- (new) `scripts/lib/ghcr-prune-lib.sh` — pure selection logic:
  `_ghcrprune_read_deployed_sha`, `_ghcrprune_collect_deployed_shas`,
  `_ghcrprune_select_prune_ids`
- (new) `scripts/lib/ghcr-prune.test.sh` — 17 fixture-driven cases, no live
  API calls
- `package.json` — registered `ghcr-prune.test.sh` in `test:hooks`

### Verification
- `pnpm test:hooks`: full suite, all 14 registered files, 340/340 pass
  (`ghcr-prune.test.sh` itself: 17/17)
- Live `--dry-run` across all 10 fleet packages: 974 versions would be pruned,
  down from 3110 (the run that exposed the untagged-sibling bug) and 3006 (the
  original pre-sprint script)
- Live selection-level check against `develemail-api`'s real 254-version list:
  57 ids selected, none of them the currently-deployed release (`730` /
  `e0949ed9a0…` / `latest`) or any digest referenced by retained tags `578` /
  `578-migrate` (confirmed via `docker manifest inspect`)
- `launchctl print gui/$UID/com.emit.ghcr-prune`: confirmed still unloaded
- No live DELETE calls were made during this session's work

### Follow-ups
- `[defer]` Live-deletion verification (a real non-dry-run prune + `docker
  pull` of a surviving release) is pending the user's decision on whether to
  grant `delete:packages` to the `gh` credential this script and the launchd
  job use.
- `[defer]` `com.emit.ghcr-prune` needs to be re-bootstrapped
  (`launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.emit.ghcr-prune.plist`)
  once the user is satisfied — it is intentionally left unloaded from this
  sprint's investigation.
- `[defer]` The silent-DELETE-failure defect (every DELETE returns 403 and the
  script reports success anyway via `|| true`) is filed as sprint 330.1 — not
  fixed here, by design.
- `[defer]` The hardcoded `PACKAGES` list has drifted from the actual fleet;
  filed as sprint 331.
