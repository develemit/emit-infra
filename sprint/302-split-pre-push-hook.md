# Split scripts/hooks/pre-push into focused modules
**Difficulty:** 4

> _Planned from sprint-297's Task 1 ("run /plan-sprint first"), 2026-08-23.
> Third and last of a three-part sequence (300 → 301 → 302). Requires
> sprints 300 and 301 to have landed first — this file sources both._

## Goal
`scripts/hooks/pre-push` (307 lines) is reduced to under ~250 lines by
extracting its config-loading and CI-phase logic into `scripts/lib/*.sh`
helpers, while the deploy-gate sequence (dry-run guard → path-filter guard →
unattended-shell guard → `_fail_deploy` definition → `deploy_init`) stays
inline in the hook file itself, in its current order, with its ordering
comments intact. `pnpm test:hooks` stays green under bash 3.2, and the gate
ordering invariant is verified explicitly.

## Reason
This is the highest-risk file of the three because it's symlinked into
**every wired project** via `core.hooksPath=.githooks` with **no version
pinning** — a broken source path here breaks every project's next push
simultaneously, not just emit-infra's own tests. It also carries the
load-bearing ordering constraint that sprints 282 and 288 fixed after real
incidents: the unattended-shell gate must sit after every gate that exits 0
(dry-run, ignored-paths) and before `_fail_deploy` is defined / `deploy_init`
runs — get this wrong and a refusal path either writes a status record it
shouldn't, or an ERR trap fires with `_EMIT_STARTED_EPOCH` unset.

Given that, this sprint deliberately extracts only the *lower-risk* parts —
config parsing and the CI phase — and leaves the sequenced deploy-gate logic
untouched in place. Restructuring the gate sequence itself is not a goal here
and should not be attempted as part of this sprint.

## Context
Read the file first: `scripts/hooks/pre-push`. It sources `ci-utils.sh`,
`deploy-plan.sh`, and `docker-build.sh` at the top (lines 19-21) — sprints 300
and 301 will have changed what's inside the first two, but not the source
line itself (both stay `_LOADED`-guarded entry points), so this sprint should
need no changes there beyond confirming they still work.

Two extractable clusters (confirmed by reading the current file, 2026-08-23):
- **config loading** (current lines ~24-59): the `python3 -c` eval block that
  reads `.emit-infra.json` into shell vars (`PROJECT_NAME`, `CI_TARGETS`,
  `ENV_FILE`, `GHCR_ORG`, etc.), plus the `DEPLOY_IGNORE_PATHS` array
  resolution that follows it. This has no dependency on anything gate-related
  — it's pure config parsing. Suggested extraction: a function like
  `load_pre_push_config "$CONFIG_FILE"` in a new
  `scripts/lib/pre-push-config.sh`, called from `pre-push` right after the
  `.emit-infra.json` existence check. Keep the `eval "$(python3 ...)"` pattern
  (it's how config vars end up in the hook's shell scope) — just move the
  heredoc/python invocation itself into the new file's function.
- **CI phase** (current lines ~65-95): the `run_ci()` function and its
  invocation. This is self-contained (installs its own ERR trap, calls
  `ci_init`/`ci_step`/`ci_done`, un-traps on success) and runs *before* the
  main-branch check and every deploy gate — extracting it doesn't touch the
  ordering invariant at all. Suggested extraction: move `run_ci()` into a new
  `scripts/lib/pre-push-ci-phase.sh` (or fold into `pre-push-config.sh` if
  that keeps things simpler), call it the same way (`run_ci`) from `pre-push`.

**What must NOT move**: everything from the `PUSHING_TO_MAIN` check (current
line ~98) through the final `deploy_done deployed` (current line ~305) stays
inline in `pre-push`, in its current order. That block contains the ordering
invariant this sprint must preserve:

```
ignored-paths filter → unattended gate → _fail_deploy definition → deploy_init
```

The inline comments explaining *why* (lines ~119-127, ~142-153, ~158-166)
must survive verbatim wherever this logic ends up (i.e., unchanged, since
this logic isn't moving).

**Bash 3.2.57 is the target.** No `declare -A`, no `${var^^}`. This file is
sourced via `set -euo pipefail` (line 6) — any extracted function must behave
correctly under that, same as today.

## Tasks
1. Extract the config-loading block into `scripts/lib/pre-push-config.sh`
   with a `_LOADED` guard, following the pattern from sprints 300/301.
2. Extract `run_ci()` into `scripts/lib/pre-push-ci-phase.sh` (or fold into
   the config file — your call, whichever keeps both files coherent and
   focused) with a `_LOADED` guard.
3. Update `pre-push` to source the new file(s) alongside its existing
   `ci-utils.sh`/`deploy-plan.sh`/`docker-build.sh` sourcing, and call the
   extracted functions in place of the removed inline code.
4. Leave the `PUSHING_TO_MAIN` → `deploy_done deployed` block untouched in
   `pre-push` itself — do not extract any part of it.
5. Run `bash -n` on every touched script.
6. Run `pnpm test:hooks` under `/bin/bash` (3.2) — assertion count must not
   drop from its current value (check with a baseline run before you start).
7. Explicitly verify the gate ordering invariant after the change: read
   through the final `pre-push` and confirm, in order: ignored-paths filter
   → unattended-shell gate → `_fail_deploy` definition → `deploy_init` call.
   State this check's result in the completion summary, not just "tests
   passed" — the invariant isn't fully covered by the test suite (per sprint
   297's own framing of the risk).

## Files involved
- `scripts/hooks/pre-push` — config-loading and CI-phase logic extracted;
  the deploy-gate sequence stays inline and untouched
- new files: `scripts/lib/pre-push-config.sh`,
  `scripts/lib/pre-push-ci-phase.sh` (or one combined file if that reads
  better — see Tasks)
- Six test suites from sprints 300/301's Context may need no changes here
  (they source the libs directly, not `pre-push`), but re-run all of
  `pnpm test:hooks` to confirm

## Acceptance criteria
- [ ] `scripts/hooks/pre-push` is under ~250 lines
- [ ] Every new extracted file is under ~150 lines
- [ ] `pnpm test:hooks` passes under bash 3.2 with the same or higher
      assertion count as the pre-split baseline
- [ ] `bash -n` is clean on every touched script
- [ ] The gate ordering invariant (ignored-paths filter → unattended gate →
      `_fail_deploy` definition → `deploy_init`) is verified explicitly by
      reading the final file, and the inline comments explaining it are
      unchanged
- [ ] One real push on a wired project confirms the hook still works end to
      end, **or** that verification is explicitly deferred to the next
      natural deploy (do not make a live production push a blocking
      criterion — it stalls headless runs; see sprint 282)

## Out of scope
- `scripts/lib/deploy-plan.sh` and `scripts/lib/ci-utils.sh` — covered by
  sprints 300 and 301, must land before this one starts
- Restructuring or extracting any part of the deploy-gate sequence itself
  (`PUSHING_TO_MAIN` through `deploy_done deployed`) — that ordering is
  load-bearing and out of scope for a pure module-reorg sprint
- `docs/PRE-PUSH-HOOK.md` — sprint 294 covers that doc
- Any behavior change. This is a pure module reorganization.
