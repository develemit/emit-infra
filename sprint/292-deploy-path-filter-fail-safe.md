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
- [ ] A range whose `git diff --name-only` output exceeds ~16KB deploys, not skips, when evaluated under `set -o pipefail` — asserted by a test (this is the 2026-08-21 incident; it is the criterion that matters most)
- [ ] `only_ignored_paths_changed` contains no pipe into `grep`; output and exit status are captured separately, matching `nx_projects` in the same file
- [ ] A `git diff` failure inside `only_ignored_paths_changed` results in a deploy, never a skip — asserted by a test that forces the error
- [ ] An empty/whitespace spec element cannot reach the pathspec list — asserted by a test
- [ ] A genuinely docs-only range still skips (the optimization isn't destroyed) — asserted by a test
- [ ] An `apps/`-touching range always deploys — asserted by a test
- [ ] Any other `cmd | grep -q` shape running under `pipefail` in `scripts/` is found and fixed or explicitly noted as safe
- [ ] A skipped deploy is reported as a definite, reasoned outcome by both the hook and `deploy-detached.sh` — no "likely", no "unknown"
- [ ] The fleet sync comparison is re-run after the fix as a sanity check (prior run found nothing stuck — see task 7)
- [ ] `docs/PRE-PUSH-HOOK.md` reflects any changed semantics
- [ ] The repo's own CI targets pass

## Out of scope
- Redesigning the deploy pipeline, blue-green slots, or the unattended-deploy gate (sprint 288) — this is about one filter and how a skip is reported
- Removing `EMIT_FORCE_DEPLOY` (it was the workaround that shipped the stuck backlog and remains a legitimate escape hatch)
- Retroactively deploying any other project found stuck in task 7 — report it, let the operator decide

## Incident reference
- Project: `emit-vision`. Stuck range `a60b807..8e3572f` (34 commits, 662 app/package files), skipped 2026-08-21.
- Resolved manually with an empty commit + `EMIT_FORCE_DEPLOY=1`, which deployed as build 1116 with both migrations applied (`2224a5d`).
- The backlog entry in `emit-vision/backlog.md` under **Active items**, dated `(infra, 2026-08-21)`, carries the same detail from the reporting side.
