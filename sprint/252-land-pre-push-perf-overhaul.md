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
- [ ] All 36 shell tests pass via `pnpm test:hooks` under both zsh-invoked bash
      and `/bin/bash` (3.2)
- [ ] `nx run-many -t typecheck lint test` green for api, dashboard, types, core, cli
- [ ] Changes committed to emit-infra main; nothing unrelated in the commit
- [ ] develemail: `resolve_last_deployed_sha` returns the history-fallback sha
      while `.deploy-status.json` still says `deploying` (validated before the
      real deploy resets it)
- [ ] develemail: `git push --dry-run` runs CI only — no GHCR auth, no builds
- [ ] develemail: sprint-only push skips deploy with the skip message
- [ ] develemail: real push deploys with a correct build/retag split; history
      entry has `phases`; status returns to `deployed`
- [ ] Test coverage: `scripts/lib/deploy-plan.test.sh` is committed and wired
      as `pnpm test:hooks`

## Out of scope
- Any change to hook behavior beyond what's already in the working tree — if
  validation finds a bug, fix it minimally and note it, don't redesign
- Wiring emit-billing / emit-social (sprint 257)
- Ansible/server-side timing (sprints 253–254)
- Dashboard rendering of `phases` (sprint 256)
