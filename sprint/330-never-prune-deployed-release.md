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
- [ ] After a real (non-dry-run) prune, `docker pull` of the currently-deployed
      tag still succeeds for at least one fleet image — the image is intact,
      not merely un-deleted
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

## In Progress

**Started:** 2026-09-12T17:40:00Z  (resumed)

### Prior progress (2026-09-12)

### Done so far
- Extracted selection logic into `scripts/lib/ghcr-prune-lib.sh`:
  `_ghcrprune_read_deployed_sha`, `_ghcrprune_collect_deployed_shas`, and the
  core `_ghcrprune_select_prune_ids` (keep-N over tagged/non-protected
  versions, `latest`/`latest-*` exemption, sha-based protection, untagged
  versions excluded from the keep budget and only deleted when strictly older
  than the oldest retained tagged version).
- `ghcr-prune.sh` now gathers deployed shas from every
  `~/projects/*/.deploy-status.json` up front and refuses to prune anything —
  loudly, exit 1, no `gh api` calls issued — if that lookup fails to parse a
  present file or comes back with zero shas.
- Wrote `scripts/lib/ghcr-prune.test.sh` (15 fixture-driven cases, no live API
  calls) and registered it in `package.json`'s `test:hooks`.
- Found and fixed a real bug during manual verification, not caught by unit
  tests: `readarray`/`mapfile` need bash 4+, but this machine's only `bash` is
  macOS's stock 3.2 (no Homebrew bash installed), which is exactly what the
  launchd job's `PATH` (`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)
  resolves `#!/usr/bin/env bash` to. The original `readarray -t PROTECTED_SHAS
  <<< "$deployed_shas"` would have failed at every scheduled run. Replaced
  with a `while IFS= read -r` loop (the pattern already used in
  `rotate-launchd-logs.sh`).
- Also found mid-verification that `gh api --paginate --jq FILTER` applies
  the filter **per page**, not once to a combined array — `--jq '.'` therefore
  emits multiple concatenated JSON documents on real (paginated) packages,
  which is invalid JSON to `json.load`. Switched the contract to JSONL (one
  version object per line, via `--jq '.[]'`), which is pagination-safe;
  updated the lib function and test fixtures (via `jq -c '.[]'`) to match.
- Verified live against the real registry (read-only): `pnpm test:hooks`
  passes in full (all suites, including the new one, 0 failures); a real
  `--dry-run` run across all 10 fleet packages completes cleanly; for
  tastease's `easyliving/api` specifically — id `1236269636` (tagged `latest`
  + the currently-deployed sha `e57a436b...`) and id `1236276499` (tagged
  `latest-migrate`) are both confirmed absent from the new selection.
  `easyliving/api` has 423 total versions but only 125 carry any tag — the old
  filter counted all 423 toward `--keep 10`; the new one counts only the 125
  real releases, so the budget now means what `--keep 10` implies.
  Independently confirmed the empty- and failed-lookup guards on the live
  script (via a `PROJECTS_DIR` override to an empty dir, and to a dir with a
  malformed `.deploy-status.json`): both exit 1 with a loud stderr message
  before any `gh api` call is made.

### Blocked on
- The one remaining criterion requires an actual **non-dry-run** prune against
  the live production GHCR registry, then a `docker pull` to prove the surviving
  image is intact. That's a real, largely irreversible deletion of registry
  data across every fleet package — not something to run unprompted. Every
  other criterion is verified above without needing to delete anything for
  real.
- What would unblock it: explicit go-ahead to run
  `bash scripts/ghcr-prune.sh --keep 10` for real (no `--dry-run`) against one
  or more packages, followed by `docker pull ghcr.io/develemit/<pkg>:<deployed-sha>`
  to confirm. Note this needs no *new* authorization in principle — the exact
  same script, unattended, already runs for real every Sunday 03:17 via
  `com.emit.ghcr-prune.plist`, and that launchd job executes whatever is on
  disk at `scripts/ghcr-prune.sh` regardless of git commit state, so this
  fixed version is already what will run this Sunday either way.

### Pickup notes
Everything is implemented, tested, and validated read-only against the live
registry — only the final destructive verification step is outstanding. To
finish: get sign-off (or just let Sunday's scheduled run be the first live
exercise, now that the protection logic is fixed and evidenced above), run the
real prune, `docker pull` to confirm, then check the last box and commit
everything under Files changed together with this section replaced by
`## Completed`.

### Resume diagnosis — the untagged rule is unsafe, evidence below

The one criterion you left open is the one that mattered. Do **not** just run
the real prune to tick it: a read-only investigation (no deletions) found the
untagged-deletion rule would corrupt retained releases.

**What was verified against the live registry, 2026-09-12:**

- `bash scripts/ghcr-prune.sh --dry-run` works under this machine's bash 3.2
  and reports `protecting 7 currently-deployed release(s)` — your protection
  logic is sound, and **currently-deployed images are genuinely safe**
  (develemail's `730`/`e0949ed…`/`latest` is newer than the cutoff, 0 doomed
  siblings). That half of the sprint is done.
- But the run would delete **3110** versions (old script: 3006), and the extra
  deletions are untagged manifests. For `develemail-api`, cutoff is
  `2026-08-01T21:50:18Z` and 164 untagged versions fall below it.
- Two *retained* tagged versions — `578` and `578-migrate` — have doomed
  untagged siblings. Resolving their manifests proves the siblings are
  referenced:

  ```
  develemail-api:578        → 2 referenced digests, 1 in the doomed set
    sha256:cabe91f1274797502d9ac77979d0e8b0ffb8e0cf6c093f85ab98b42735e2c1f8
  develemail-api:578-migrate → 2 referenced digests, 1 in the doomed set
  ```

  That digest resolves today and is the **real platform image manifest**
  (`application/vnd.oci.image.manifest.v1+json`, 8 layers) — not an
  attestation. Deleting it leaves `578` tagged and unpullable.

**Why the rule fails:** tagged versions are retained by *count* while untagged
are deleted by a *time* cutoff. A manifest list retained by the count rule can
have its own platform manifest — written a second earlier — fall below the
cutoff. The old script never hit this because it deleted purely by time, so
parent and child always went together.

**Do this:**

1. Fix the untagged rule. The sprint's Context already names the safe fallback:
   *"If that proves hard to establish reliably, leave untagged pruning exactly
   as it is today and just fix the accounting."* Given the above, take it —
   keep untagged versions out of the `KEEP` budget (the real win, and it
   already works), and **stop deleting untagged versions** unless you can prove
   they are unreferenced. If you prefer the stronger fix, resolve each retained
   tagged version's manifest and add its referenced digests to the protected
   set; only then may unreferenced untagged versions be deleted.
2. Add a regression test to `scripts/lib/ghcr-prune.test.sh` with a fixture in
   exactly this shape — a retained tagged manifest list whose referenced
   untagged manifest sits below the cutoff — asserting the referenced digest is
   never selected. This is the case that would have shipped.
3. Re-run the dry-run and report the new total (3110 should drop).
4. **The scheduled job is currently unloaded** (`launchctl bootout
   gui/$UID/com.emit.ghcr-prune`, 2026-09-12) so nothing runs unattended while
   this is being fixed. Do not re-enable it; say in your report that it needs
   re-bootstrapping once the user is satisfied.
5. For the final criterion, a real prune is now **authorized on one package
   only** — pick a package and quote a `docker pull` of a retained release both
   before and after. If your fix means untagged are no longer deleted, say so
   and scope the live check accordingly.
6. Commit everything together, including the predecessor's uncommitted files
   (resume rules, Step 0).

