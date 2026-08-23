# Make the deploy path filter fail toward deploying, and make a skip visible
**Difficulty:** 3

## Goal
A deploy is never silently skipped when real application code changed, and when
a skip *is* correct the operator can see why without reading the log by hand.

## Reason
On 2026-08-21 an emit-vision push of **34 commits** (sprints 473–484 — the whole
Search Console integration, UTM capture, per-project domains, crawler
classification) landed on `main` and **did not deploy**. The hook printed:

```
→ only non-deploy paths changed since last deploy (a60b807); skipping deploy (EMIT_FORCE_DEPLOY=1 to override)
```

That determination was wrong. `git diff --name-only a60b807..HEAD` over that
range shows **662 files under `apps/` and `packages/`** — `apps/api/src/deps/analytics.ts`,
`apps/web`, `apps/worker`, `packages/clickhouse`, and so on. Production stayed on
build 1081 while the push reported success and CI passed green.

**The failure is silent, which is what makes it serious.** There is no error, no
non-zero exit, no failed check. `git push` succeeds, CI passes, the operator
reasonably believes they shipped, and prod quietly stays behind. Here it hid a
34-commit backlog including two database migrations. It was only caught because
someone checked `/healthz` and noticed the build number hadn't moved.

**And it scales the wrong way.** The root cause (SIGPIPE under `pipefail` — see
Context) means the filter breaks precisely when the diff is *large*: the more
code a push contains, the likelier it is silently dropped. Small pushes deploy
fine, which is why this went unnoticed for so long. Every project using this
hook is exposed, and the exposure grows with the size of the push.

## Context

### What was already ruled out (don't redo this)
- **Not a project misconfiguration.** `emit-vision`'s `.emit-infra.json` sets
  neither `ci.deployIgnorePaths` nor `ci.deployIgnorePathsExtra`, so the built-in
  defaults applied: `sprint/**`, `docs/**`, `backlog.md`, `*.md`.
- **Not a wrong base SHA.** `resolve_last_deployed_sha` returned `a60b807`, which
  was genuinely the last deployed commit (build 1081, deployed 2026-08-16).
- **Not a cwd problem.** `deploy-detached.sh`'s `launch()` does `cd "$1"` into
  `PROJECT_DIR` before pushing, so the `-- .` pathspec is anchored correctly.
- **It IS reproducible — the earlier attempt was missing one shell option.**
  Re-running `only_ignored_paths_changed` in a bare shell returns *deploy*,
  which is what made this look non-deterministic. But `scripts/hooks/pre-push`
  sets `set -euo pipefail` on line 6, and sourcing the lib into a plain shell
  does not. With `pipefail` set, the real range + real ignore list reproduces
  the skip **5 times out of 5**. The trigger is identified — see below. Do not
  spend a session re-investigating it.

### The actual mechanism: SIGPIPE + pipefail (confirmed, reproduced 5/5)
`scripts/lib/deploy-plan.sh:104`:

```bash
! git diff --name-only "$base"..HEAD -- . "${specs[@]}" | grep -q .
```

**The failure is the inverse of "an error looks like no changes".** `grep -q`
exits as soon as it sees the **first** match — that is, the moment it learns
files *did* change. That closes the pipe while `git diff` is still writing, so
git dies of `SIGPIPE` (exit 141). `pre-push` runs under `set -euo pipefail`
(line 6), so `pipefail` promotes 141 to the pipeline's status; `!` inverts
non-zero to *true*; the caller reads that as "only ignored paths changed" and
skips the deploy.

So the filter fails **precisely when a lot of files changed** — the bigger the
push, the likelier it silently refuses to ship it. Small pushes are fine because
git finishes writing before grep exits.

**The threshold is diff *output size*, not commit count** — it's the OS pipe
buffer (~16KB on macOS). Measured on this machine:

| `git diff --name-only` output | pipeline status |
|---|---|
| 8,893 bytes | 0 — deploys correctly |
| 23,893 bytes | **141 — silently skips** |

The 2026-08-21 incident's range produced **29,002 bytes** with the exclude specs
applied. Any push touching roughly 350–400+ files is exposed, in any project.

Reproduction (real range, real ignore list, real function):

```console
$ bash -c 'set -euo pipefail
  source scripts/lib/deploy-plan.sh
  only_ignored_paths_changed a60b807 "sprint/**" "docs/**" "backlog.md" "*.md"'
# → returns true (SKIP) — 5/5 runs. Without `set -o pipefail`: returns false (deploy).
```

### The codebase already learned this lesson four lines below
`nx_projects` (same file, ~line 117) carries this comment:

> *"Distinguishing 'nx failed' from 'nx says nothing is affected' matters:
> swallowing an error would look like an empty affected set and silently skip
> every rebuild."*

It captures output and exit status into separate variables specifically to avoid
this. `only_ignored_paths_changed` never got the same treatment. **Follow that
existing shape** — it is the in-repo precedent for the correct fix.

### A specific way an empty element can get in
`deploy-plan.sh:100-102`:

```bash
local specs=() spec_list
spec_list=$(deploy_ignore_specs "$@")
while IFS= read -r spec; do specs+=("$spec"); done <<< "$spec_list"
```

A here-string of an empty `spec_list` is a single newline, so the loop appends one
**empty-string element** — exactly the input shown above to poison the diff. Worth
confirming whether `deploy_ignore_specs` can return empty in practice (it has a
`[[ $# -gt 0 ]] || return 1` guard upstream at line 93, so this may be
unreachable today — but the loop is fragile regardless and costs nothing to
harden).

### Reporting made it harder to notice
`deploy-detached.sh` reported the outcome as:

```
→ push completed (exit 0); no deploy record for 8e3572f — deploy was likely skipped (ignored paths / nothing to build)
  services: unknown
```

That's an inference from a *missing* record, not a reported fact, and it reads as
routine. The hook knows exactly why it skipped and could say so. "Likely" and
"unknown" are doing a lot of work in a message that means "your code is not in
production."

### Files involved
- `scripts/lib/deploy-plan.sh` — `only_ignored_paths_changed` (line 91), `deploy_ignore_specs`, `resolve_last_deployed_sha` (line 43)
- `scripts/hooks/pre-push` — the path-filter call site (line 147) and its skip message
- `scripts/deploy-detached.sh` — the "no deploy record … likely skipped" reporting path
- `scripts/lib/deploy-unattended-gate.test.sh` — existing shell-test convention to follow for new tests
- `docs/PRE-PUSH-HOOK.md` — documents the filter's contract; update if the semantics change

## Tasks
1. Rewrite `only_ignored_paths_changed` to **remove the pipe entirely** —
   checking the exit status alone is not sufficient, because the pipe is what
   creates the SIGPIPE in the first place. Capture output and status into
   separate variables, mirroring `nx_projects` in the same file:

   ```bash
   local out rc
   out=$(git diff --name-only "$base"..HEAD -- . "${specs[@]}" 2>/dev/null); rc=$?
   [[ $rc -eq 0 ]] || return 1   # diff failed => deploy, never skip
   [[ -z "$out" ]]               # empty => genuinely only ignored paths changed
   ```

   This closes both the SIGPIPE hole and the errored-diff hole at once.
2. Harden spec construction so an empty or whitespace-only element can never
   reach the pathspec list. **This is unrelated to the 2026-08-21 incident** —
   the `[[ $# -gt 0 ]] || return 1` guard at line 93 makes it unreachable from
   the hook's call path (verified). Keep it as cheap defence-in-depth; do not
   mistake it for the fix.
3. The trigger is already identified (SIGPIPE + `pipefail`, see Context) — do
   **not** re-investigate it. Instead, grep the rest of `scripts/` for the same
   `cmd | grep -q` shape running under `pipefail`, since any other instance has
   the identical latent bug, and fix or note what you find.
4. Make a skip loud and specific: the hook should state which paths it considered
   ignorable and that **no deploy will happen**, and `deploy-detached.sh` should
   report a skip as a distinct, definite outcome rather than inferring "likely
   skipped" from a missing record.
5. **Do not add a "large diffs are never skippable" heuristic.** That was
   proposed before the mechanism was known, and it treats a symptom: large
   diffs are not inherently riskier to skip, they are simply the ones that
   *broke the filter*. Once task 1 lands, the correlation disappears and such a
   rule would only skip deploys that should have been skipped.
6. Add shell tests following `deploy-unattended-gate.test.sh`'s pattern. The
   **regression test that actually matters** is a range whose
   `git diff --name-only` output exceeds ~16KB, asserted under
   `set -o pipefail` — that is the incident. Plus: diff error → deploys;
   genuinely docs-only range → skips; app-code range → deploys; empty spec
   element → deploys.
7. The fleet audit was already run on 2026-08-21: `emit-social`, `tastease`,
   `develemail`, `emit-vision`, and `diner-decider` were all in sync;
   `emit-billing` was behind by one commit containing only
   `sprint/57-ghcr-image-pipeline.md`, which is a correct skip under the default
   ignore patterns. **Nothing else was silently stuck.** Re-run the comparison
   as a sanity check after the fix lands, but do not treat it as open
   investigation.

## Acceptance criteria
- [x] A range whose `git diff --name-only` output exceeds ~16KB deploys, not skips, when evaluated under `set -o pipefail` — asserted by a test (this is the 2026-08-21 incident; it is the criterion that matters most)
- [x] `only_ignored_paths_changed` contains no pipe into `grep`; output and exit status are captured separately, matching `nx_projects` in the same file
- [x] A `git diff` failure inside `only_ignored_paths_changed` results in a deploy, never a skip — asserted by a test that forces the error
- [x] An empty/whitespace spec element cannot reach the pathspec list — asserted by a test
- [x] A genuinely docs-only range still skips (the optimization isn't destroyed) — asserted by a test
- [x] An `apps/`-touching range always deploys — asserted by a test
- [x] Any other `cmd | grep -q` shape running under `pipefail` in `scripts/` is found and fixed or explicitly noted as safe
- [x] A skipped deploy is reported as a definite, reasoned outcome by both the hook and `deploy-detached.sh` — no "likely", no "unknown"
- [x] The fleet sync comparison is re-run after the fix as a sanity check (prior run found nothing stuck — see task 7)
- [x] `docs/PRE-PUSH-HOOK.md` reflects any changed semantics
- [x] The repo's own CI targets pass

## Out of scope
- Redesigning the deploy pipeline, blue-green slots, or the unattended-deploy gate (sprint 288) — this is about one filter and how a skip is reported
- Removing `EMIT_FORCE_DEPLOY` (it was the workaround that shipped the stuck backlog and remains a legitimate escape hatch)
- Retroactively deploying any other project found stuck in task 7 — report it, let the operator decide

## Completed

**Date:** 2026-08-21

### Summary
Fixed the actual mechanism (SIGPIPE + `pipefail`, already root-caused before this
sprint started): `only_ignored_paths_changed` in `scripts/lib/deploy-plan.sh` no
longer pipes `git diff --name-only` into `grep -q`. It now captures the diff's
output and exit status into separate variables — the same shape `nx_projects`
in the same file already used — and treats a `git diff` failure as "deploy,
never skip." This removes the pipe entirely, so there's no longer a race for
`grep -q` to win by closing the pipe early and killing `git diff` with SIGPIPE
on large output.

While sweeping `scripts/` for the same `cmd | grep -q` shape under `pipefail`
(task 3), found two more instances in the same file with the identical latent
bug — `_trigger_paths_changed` and `service_needs_build`'s glob fallback —
both fixed the same way. `collect-metrics.sh` has two visually-similar
instances; investigated both: one runs in a remote script that never sets
`pipefail` at all, the other pipes a single ~200-400 byte captured string
(two orders of magnitude under the ~16KB/64KB pipe-buffer threshold that
triggers this), so neither is actually exposed — noted inline rather than
changed.

Also hardened `deploy_ignore_specs` to drop blank/whitespace patterns before
they become pathspecs: an empty `:(exclude,glob)` isn't a no-op, it's
confirmed (empirically, via a throwaway git repo) to match *every* path, so a
stray blank pattern would silently exclude an entire diff. The existing
`$# -gt 0` guard makes this unreachable from the hook's real call path today,
but it's cheap defense-in-depth and now has its own test.

Made a skip loud: `scripts/hooks/pre-push`'s skip message now leads with `⚠`
(not the routine `→`), names the ignored patterns applied, and states plainly
that no deploy will run. `scripts/deploy-detached.sh`'s `print_summary` now
greps that exact line back out of the detached push's log and reports it
verbatim instead of guessing "likely skipped" from a missing deploy record —
"unknown" services also became `(none — no deploy ran)` on that path, since
"no deploy ran" is a known fact, not an unknown one.

Deliberately did not add a "large diffs never skip" heuristic (task 5) — the
correlation between diff size and the false skip was a symptom of the SIGPIPE
bug, not an independent risk; removing the pipe removes the correlation, and
a size-based override would only end up blocking genuinely-correct skips on
big but ignorable pushes (e.g. a huge `docs/**` restructure).

New test file `scripts/lib/deploy-path-filter.test.sh` reproduces the incident
directly: a 3000-file, ~198KB diff, run under real `set -euo pipefail`
semantics (a fresh `bash -c`, matching how `scripts/hooks/pre-push` actually
runs), asserted to deploy. Verified this test fails against the pre-fix code
(5/5 relevant cases) and passes against the fix, confirming it's a real
regression test and not a tautology.

### Files changed
- `scripts/lib/deploy-plan.sh` — `only_ignored_paths_changed`, `deploy_ignore_specs`, `_trigger_paths_changed`, `service_needs_build`'s glob fallback: removed all `cmd | grep -q` pipes under pipefail; blank pathspec elements filtered
- `scripts/hooks/pre-push` — path-filter skip message now names what was ignored and states no deploy will run, with a distinct `⚠` prefix
- `scripts/deploy-detached.sh` — `print_summary` reads the real skip reason back from the log (`_skip_reason_from_log`) instead of inferring "likely skipped"; "unknown" services replaced with an accurate "(none — no deploy ran)"
- `scripts/collect-metrics.sh` — added a comment documenting why its two `cmd | grep -q` instances are not exposed to the same hazard (not reviewed/fixed, confirmed safe)
- `docs/PRE-PUSH-HOOK.md` — documents the new skip message shape and the sprint 292 SIGPIPE root cause
- `package.json` — wired the new test file into `test:hooks`
- (new) `scripts/lib/deploy-path-filter.test.sh` — regression tests for the incident, diff-failure, empty-spec, and positive-control cases, all run under real `pipefail`
- `scripts/lib/deploy-detached.test.sh` — added a test asserting `print_summary`'s skip message contains neither "likely" nor "unknown"

### Verification
- `bash scripts/lib/deploy-path-filter.test.sh`: 7/7 pass; confirmed 5/7 fail against the pre-fix code (stashed), proving the tests are real regressions
- `pnpm test:hooks` (all 8 shell suites): 160/160 pass, 0 failed
- `pnpm nx affected -t lint typecheck test --base=origin/main`: 42 test files / 356 tests pass, lint and typecheck clean
- `pnpm nx run cli:build`: succeeds (this is the dist the hooks actually run — see stale-dist memory note)
- `pnpm nx run dashboard:build`: fails on a pre-existing, unrelated Next.js `<Html>` outside `_document` bug, confirmed present on clean `main` before this sprint's changes (tracked in `backlog.md` since sprint 04, `[hold]`) — not in scope, not touched
- Fleet sync re-run (task 7): `emit-social`, `tastease`, `develemail`, `emit-vision`, `diner-decider` all in sync with `origin/main`; `emit-billing` behind by 1 commit (`sprint/57-ghcr-image-pipeline.md` only) — confirmed a correct skip under the default ignore patterns, matching the prior 2026-08-21 finding exactly

### Follow-ups
- `[defer]` `scripts/lib/deploy-plan.sh` is now 329 lines (was 300 before this sprint), over the repo's ~300-line file-size guideline. It's grown incrementally sprint over sprint (see its "fix N" comment convention); a natural split would separate the path-filter helpers (`deploy_ignore_specs`, `only_ignored_paths_changed`) and the smart-build helpers (`nx_available`/`nx_projects`/`_list_has`/`_trigger_paths_changed`/`service_needs_build`) into their own lib files. Didn't do it here since it touches sourcing in `pre-push`, `deploy-detached.sh`, and three test files, and this sprint's scope was one filter's behavior, not a module reorg.
- `[defer]` `scripts/hooks/pre-push` is now 307 lines (was 305), a few lines past the same guideline — not worth a standalone sprint on its own, but worth folding into the `deploy-plan.sh` split above if that ever happens.
- `[defer]` `scripts/collect-metrics.sh:72` (`echo "$q" | grep -qE ...` inside the remote-executed script) isn't under `pipefail` at all today, so it's not exposed — but if that remote script ever gains `set -o pipefail`, this line would need the same fix as the rest of this sprint.

## Incident reference
- Project: `emit-vision`. Stuck range `a60b807..8e3572f` (34 commits, 662 app/package files), skipped 2026-08-21.
- Resolved manually with an empty commit + `EMIT_FORCE_DEPLOY=1`, which deployed as build 1116 with both migrations applied (`2224a5d`).
- The backlog entry in `emit-vision/backlog.md` under **Active items**, dated `(infra, 2026-08-21)`, carries the same detail from the reporting side.
