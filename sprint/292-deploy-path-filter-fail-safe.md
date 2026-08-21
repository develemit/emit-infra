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

Every project using this hook is exposed to the same failure mode.

## Context

### What was already ruled out (don't redo this)
- **Not a project misconfiguration.** `emit-vision`'s `.emit-infra.json` sets
  neither `ci.deployIgnorePaths` nor `ci.deployIgnorePathsExtra`, so the built-in
  defaults applied: `sprint/**`, `docs/**`, `backlog.md`, `*.md`.
- **Not a wrong base SHA.** `resolve_last_deployed_sha` returned `a60b807`, which
  was genuinely the last deployed commit (build 1081, deployed 2026-08-16).
- **Not a cwd problem.** `deploy-detached.sh`'s `launch()` does `cd "$1"` into
  `PROJECT_DIR` before pushing, so the `-- .` pathspec is anchored correctly.
- **Not reproducible after the fact.** Re-running
  `only_ignored_paths_changed a60b807 "${EMIT_DEFAULT_DEPLOY_IGNORE_PATHS[@]}"`
  against the identical range and ignore list returns *deploy* (false) — in both
  `bash` and the `sh` POSIX mode husky's wrapper uses. **So the same inputs do
  not reproduce it.** Treat "find the exact trigger" as a real possibility but
  not a precondition for fixing the structural bug below.

### The structural bug (confirmed, reproducible, fix this regardless)
`scripts/lib/deploy-plan.sh:104`:

```bash
! git diff --name-only "$base"..HEAD -- . "${specs[@]}" | grep -q .
```

This conflates **"git diff produced no output because nothing changed"** with
**"git diff produced no output because it errored."** Any failure of that command
— bad pathspec, unreadable object, anything on stderr — yields empty stdout,
`grep -q .` fails, `!` inverts it to *true*, and the caller skips the deploy.

The function's own documented intent is the opposite. `scripts/hooks/pre-push:143-146`
says: *"Unknown paths always deploy (safe default)."* The implementation does not
honour that when the diff itself fails.

Demonstrated concretely — one empty-string pathspec element is enough:

```console
$ git diff --name-only a60b807..HEAD -- . ""
fatal: empty string is not a valid pathspec. please use . instead if you meant to match all paths
# → empty stdout → filter reports "only ignored paths changed" → SKIP
```

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
1. Make the filter fail toward deploying: capture `git diff`'s exit status
   separately from its output, and on any non-zero status **deploy** (never skip).
   This alone closes the silent-skip hole even if the original trigger is never
   identified.
2. Harden spec construction so an empty or whitespace-only element can never reach
   the pathspec list.
3. Attempt to identify the actual 2026-08-21 trigger — check whether anything
   about a 34-commit / 662-file / ~14-day-old range behaves differently (argument
   length limits, `.deploy-status.json` state mid-write, husky's `sh -e` wrapper).
   **A clean "could not determine, here's what was excluded" is an acceptable
   outcome** — the fix in task 1 does not depend on it.
4. Make a skip loud and specific: the hook should state which paths it considered
   ignorable and that **no deploy will happen**, and `deploy-detached.sh` should
   report a skip as a distinct, definite outcome rather than inferring "likely
   skipped" from a missing record.
5. Consider whether a *large* diff should ever be skippable at all — e.g. refuse
   to skip when the range exceeds N commits or touches `apps/`/`packages/` at all,
   on the grounds that the optimization's value (avoiding a docs-only rebuild) is
   small and its failure cost is an un-deployed backlog.
6. Add shell tests following `deploy-unattended-gate.test.sh`'s pattern: diff
   error → deploys; genuinely docs-only range → skips; app-code range → deploys;
   empty spec element → deploys (not skips).
7. Audit the other projects using this hook for evidence of the same silent skip
   (compare each project's last deployed SHA against its `origin/main`), and
   report any found — this may have happened elsewhere unnoticed.

## Acceptance criteria
- [ ] A `git diff` failure inside `only_ignored_paths_changed` results in a deploy, never a skip — asserted by a test that forces the error
- [ ] An empty/whitespace spec element cannot reach the pathspec list — asserted by a test
- [ ] A genuinely docs-only range still skips (the optimization isn't destroyed) — asserted by a test
- [ ] An `apps/`-touching range always deploys — asserted by a test
- [ ] The 2026-08-21 trigger is either identified with evidence, or explicitly documented as not-reproducible with the hypotheses that were excluded
- [ ] A skipped deploy is reported as a definite, reasoned outcome by both the hook and `deploy-detached.sh` — no "likely", no "unknown"
- [ ] Other fleet projects are checked for the same silent skip and findings reported
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
