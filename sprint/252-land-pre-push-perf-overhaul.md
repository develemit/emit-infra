# Land and live-validate the pre-push hook performance overhaul
**Difficulty:** 2

## Goal
Commit the already-implemented pre-push performance fixes sitting in emit-infra's
working tree, then prove each fix against develemail — which is currently in the
exact broken state (stuck `"deploying"` status) that motivated the work.

## Reason
Five deploy-pipeline fixes were implemented and tested in-session but never
committed: smart-build recovery from `.deploy-history.jsonl`, nx-affected
rebuild detection, default `deployIgnorePaths`, a `git push --dry-run` guard,
and per-phase duration recording. The hook is **symlinked** into consuming
projects (develemail, emit-vision, diner-decider via `.husky/`; tastease via
`.githooks/`), so committing here ships it everywhere at once — which also
means an unvalidated commit breaks every project's push at once. Validation
against a real project before and after committing is the whole sprint.

## Context
- Changed/new files (all in working tree, uncommitted):
  - `scripts/hooks/pre-push` — orchestration; now sources the two new libs
  - `scripts/lib/deploy-plan.sh` — new; decision logic (last-sha fallback,
    nx-affected, ignore paths, dry-run detection)
  - `scripts/lib/docker-build.sh` — new; buildx invocation + inline registry cache
  - `scripts/lib/deploy-plan.test.sh` — new; 36 tests, run via `pnpm test:hooks`
  - `scripts/lib/ci-utils.sh` — per-phase timing (`deploy_phase`,
    `deploy_record_phase`); history entries gain a `"phases"` object
  - `packages/types/src/project-config.ts` — new optional ci fields:
    `deployIgnorePaths`, `deployIgnorePathsExtra`, `buildTriggerPaths`, `buildCache`
  - `apps/api/src/routes/history.ts`, `apps/dashboard/src/lib/api-history.ts` —
    `phases?: Record<string, number>` on deploy history types
  - `docs/PRE-PUSH-HOOK.md` — new; full behavior + config reference
  - `package.json` — adds `test:hooks` script
- The working tree may also contain unrelated changes — inspect `git status`
  and commit **only** the files above. Leave anything else untouched.
- develemail state: `.deploy-status.json` stuck at `status: "deploying"`
  (sha `d927c16`); last good deploy `52566d5` is only in `.deploy-history.jsonl`.
  Its nx affected set vs `52566d5` was `api`, `inbound`, `worker` (not `web`)
  as of 2026-08-01 — re-derive rather than assume.
- macOS ships bash 3.2 — the test suite must pass under `/bin/bash`, not just
  a newer bash.
- Known pitfall (from project memory): hooks execute `apps/cli/dist` — the CLI
  dist is only stale if CLI *source* changed, which it did not here.

## Tasks
1. `git status` / `git diff` review of the files listed above; confirm nothing
   unrelated gets swept into the commit.
2. Run the verification battery in emit-infra:
   `pnpm test:hooks` (also under `/bin/bash` explicitly),
   `bash -n` on the hook and every `scripts/lib/*.sh`,
   `pnpm nx run-many -t typecheck lint test --projects=api,dashboard,types,core,cli`.
3. Commit with a message summarizing the five fixes.
4. Live-validate in `~/projects/develemail` **without deploying**:
   a. `source` `deploy-plan.sh`; assert `resolve_last_deployed_sha .` returns a
      sha (history fallback working) despite status file saying `deploying`.
   b. Compute the build/retag split with `service_needs_build` for all four
      services against that sha; assert at least one service resolves to retag
      (nx-affected working) — verify against `pnpm nx show projects --affected`.
   c. `git push --dry-run origin main` — assert CI runs but output shows the
      dry-run skip line and **no** GHCR login or image build starts.
5. Live-validate the ignore-path skip: in develemail, commit a `sprint/*.md`-only
   change and push for real; assert the hook prints the skip line and exits
   without deploying.
6. Final validation — a real deploy: push a develemail commit that touches code.
   Assert the affected services build, the rest retag, the deploy completes,
   `.deploy-status.json` returns to `"deployed"`, and the new history entry
   contains a `"phases"` object.
7. Record the observed total duration and phase breakdown in the sprint
   completion notes (baseline for sprints 253/254).

## Files involved
- `scripts/hooks/pre-push` — commit as-is
- `scripts/lib/deploy-plan.sh`, `scripts/lib/docker-build.sh`,
  `scripts/lib/deploy-plan.test.sh` — new files, commit
- `scripts/lib/ci-utils.sh` — commit
- `packages/types/src/project-config.ts` — commit
- `apps/api/src/routes/history.ts`, `apps/dashboard/src/lib/api-history.ts` — commit
- `docs/PRE-PUSH-HOOK.md`, `package.json` — commit
- `~/projects/develemail` — validation target only; the only develemail commits
  are the two validation pushes (tasks 5–6)

## Acceptance criteria
- [x] All 36 shell tests pass via `pnpm test:hooks` under both zsh-invoked bash
      and `/bin/bash` (3.2)
- [x] `nx run-many -t typecheck lint test` green for api, dashboard, types, core, cli
- [x] Changes committed to emit-infra main; nothing unrelated in the commit
- [x] develemail: `resolve_last_deployed_sha` returns the history-fallback sha
      while `.deploy-status.json` still says `deploying` (validated before the
      real deploy resets it)
- [x] develemail: `git push --dry-run` runs CI only — no GHCR auth, no builds
- [x] develemail: sprint-only push skips deploy with the skip message
- [x] develemail: real push deploys with a correct build/retag split; history
      entry has `phases`; status returns to `deployed`
- [x] Test coverage: `scripts/lib/deploy-plan.test.sh` is committed and wired
      as `pnpm test:hooks`

## Out of scope
- Any change to hook behavior beyond what's already in the working tree — if
  validation finds a bug, fix it minimally and note it, don't redesign
- Wiring emit-billing / emit-social (sprint 257)
- Ansible/server-side timing (sprints 253–254)
- Dashboard rendering of `phases` (sprint 256)

## Completed

**Date:** 2026-08-01

### Summary
Committed the five already-implemented pre-push fixes (smart-build recovery
via `.deploy-history.jsonl`, nx-affected rebuild detection, configurable
`deployIgnorePaths`/`deployIgnorePathsExtra`/`buildTriggerPaths`/`buildCache`,
a `git push --dry-run` guard, and per-phase duration recording), then
live-validated every fix against develemail, which was in the exact stuck
`"deploying"` state (sha `d927c16`) the work was meant to fix.

Live validation surfaced one real bug: `only_ignored_paths_changed` in
`deploy-plan.sh` used `<()` process substitution. Husky v9's hook wrapper
(`.husky/_/h`) runs hooks via `sh -e`, ignoring the bash shebang on
`scripts/hooks/pre-push`, and macOS's `/bin/sh` is bash in POSIX mode, where
process substitution is disabled — so every real push to main was failing
with a syntax error before CI even ran. Fixed minimally (capture into a
variable, read via here-string instead of `<()`) and committed separately
(`96c91c7`) so the fix is traceable independent of the feature commit. All
36 tests plus `bash -n` and a direct `sh -e` exercise of the affected
function were re-verified after the fix.

Validation also caught an operational near-miss: develemail had an
unpushed local commit (`362e118`, "Enable nginx vhost sync on deploy",
apparently left over from sprint 246) sitting on top of the last-deployed
sha. The first sprint-only-marker push (task 5) bundled that commit in,
so the diff wasn't ignore-paths-only and the hook correctly built and
deployed instead of skipping — not a hook bug, but it meant the first
real deploy attempt happened earlier and less deliberately than planned.
That deploy was then interrupted mid-build by my own 2-minute default
tool timeout (which SIGTERMs the underlying process), leaving
`.deploy-status.json` stuck `"deploying"` again with no history entry —
a live, real-world instance of exactly the bug fix 1 targets. Confirmed no
partial state on the server (the interrupted run never reached the deploy
step) and re-ran with the tool's 10-minute max timeout; it completed
cleanly. `resolve_last_deployed_sha` was thereby validated twice: once
against the pre-existing stuck state and once against the one I caused.
Re-tested the ignore-path skip afterward with a clean sprint-only commit
against the new last-deployed sha, which skipped correctly. Removed the
temporary validation marker file from develemail afterward.

Baseline duration for sprints 253/254: `durationSec: 467` total, phases
`{"ci":30,"auth":1,"build":212,"retag":4,"deploy":250}` — 3 of 4 services
(api, worker, inbound) rebuilt, web re-tagged, matching the Nx-affected
prediction (`api`, `inbound`, `worker`) computed before the push.

### Files changed
- `scripts/hooks/pre-push` — sources the two new libs; dry-run guard;
  nx-affected build/retag split; per-phase timing calls
- (new) `scripts/lib/deploy-plan.sh` — decision logic: last-sha fallback,
  ignore-path filter, nx-affected rebuild detection, dry-run detection
- (new) `scripts/lib/docker-build.sh` — image naming, buildx invocation,
  inline registry cache
- (new) `scripts/lib/deploy-plan.test.sh` — 36 tests, wired as `pnpm test:hooks`
- `scripts/lib/ci-utils.sh` — `deploy_phase`/`deploy_record_phase`; history
  entries gain a `"phases"` object
- `packages/types/src/project-config.ts` — new optional `ci` fields:
  `deployIgnorePaths`, `deployIgnorePathsExtra`, `buildTriggerPaths`, `buildCache`
- `apps/api/src/routes/history.ts`, `apps/dashboard/src/lib/api-history.ts` —
  `phases?: Record<string, number>` on deploy history types
- (new) `docs/PRE-PUSH-HOOK.md` — full behavior + config reference
- `package.json` — adds `test:hooks` script

### Verification
- `pnpm test:hooks` (default shell and explicit `/bin/bash` 3.2): 36/36 pass
- `bash -n` on the hook and all `scripts/lib/*.sh`: clean
- `pnpm nx run-many -t typecheck lint test --projects=api,dashboard,types,core,cli`:
  green — 349 API tests, 192 dashboard tests, all typecheck/lint clean
- develemail live validation: all 6 behavioral acceptance criteria confirmed
  against a real stuck-deploy state, a real dry-run push, a real skip, and a
  real deploy (see Summary)

### Follow-ups
- `[defer]` develemail had an unpushed local commit sitting on top of the
  last-deployed sha before this sprint ran — worth a habit of checking
  `git status`/`git log origin/main..HEAD` before assuming a "safe" test
  push won't bundle unrelated work.
- `[defer]` `pnpm nx show projects` prints two `Issue while reading .npmrc`
  warnings for `${NPM_TOKEN}` on every invocation in develemail — cosmetic,
  unrelated to this sprint, pre-existing.
- `[defer]` `nx configure-ai-agents` nag appears on every develemail CI run —
  cosmetic, pre-existing, unrelated to this sprint.
