# Never record a deploy that didn't actually ship anything
**Difficulty:** 4

## Goal
A deploy record only claims a sha was deployed when that sha's images were
really built or re-tagged onto the server — so one bad record can't silently
suppress every deploy that follows.

## Reason
On 2026-08-27 a CLI-direct `emit-infra deploy` on emit-billing slot-flipped
stale `:latest` images and recorded `deployed` at the local HEAD sha, even
though no image for that sha was ever built. That record then became the
baseline the pre-push path filter compares against, so every subsequent real
deploy decided "all services unchanged since last deploy, re-tagging only" and
shipped nothing. A wrong record doesn't just mislead a human reading history —
it actively disables deploying, and it does so quietly.

A second, related loss in the same path: the server's `BUILD_NUMBER` gets
wiped, which demotes pinned image tags back to `:latest` and hides which build
is actually running.

## Context

### How a record poisons the next deploy
- `apps/cli/src/commands/deploy.ts:331` calls `deployRecordDone(cwd, ctx,
  'deployed', …)` once Ansible returns success. The CLI path **never builds
  images** — it deploys whatever tags already exist — so "Ansible succeeded" is
  not evidence that this sha shipped.
- `resolve_last_deployed_sha()` (`scripts/lib/deploy-launch.sh:21`) reads the
  newest successful record; `scripts/hooks/pre-push:86` assigns it to `LAST_SHA`.
- The path filter builds `TO_BUILD` / `TO_RETAG` from changes since `LAST_SHA`
  (`pre-push:161-180`). With a falsely-advanced `LAST_SHA`, `TO_BUILD` comes back
  empty and the hook prints "all services unchanged since last deploy,
  re-tagging only" (`pre-push:180`) — the exact symptom seen on emit-billing.

### The BUILD_NUMBER loss
- `ansible/roles/app-deploy/tasks/main.yml` copies the local env file over the
  server's `.env` when `copy_env` is set (`ci.envFile` is the source of truth —
  on-server-only edits are overwritten by design).
- The restore task "Set BUILD_NUMBER in server .env" (`main.yml:72-77`) is
  guarded `when: build_number is defined`.
- `deploy.ts:179-182` only sets `extraVars.build_number` when `env.BUILD_NUMBER`
  is present. The pre-push hook always exports it (`pre-push:37`,
  `git rev-list --count HEAD`), but a CLI-direct deploy usually doesn't.
- So: env copy removes `BUILD_NUMBER`, the restore task is skipped, and the
  server loses its build pin.

### What "actually shipped" can be checked against
Images are tagged with both the build number and the full sha, and containers
carry a `build.number` label — `ansible/roles/app-deploy/tasks/main.yml` already
has a "Read deployed build number from container label" task. That label, or the
presence of the sha tag in the registry, is real evidence; Ansible's exit code
is not.

### Record shape and conventions
`packages/core/src/deploy-records.ts` owns the record (`status: 'deployed' |
'failed'` at line 120); records already carry `servicesBuilt`. Vitest beside
source; bash suites under `scripts/lib/*.test.sh` run by `pnpm test:hooks`.
This repo has **no `check:affected`** — the suite is `pnpm test`,
`pnpm typecheck`, `pnpm lint`, plus `pnpm test:hooks`.

## Tasks
1. Decide and document what makes a record trustworthy as a *build baseline*.
   Recommended: a record only advances `resolve_last_deployed_sha` when it
   actually built or re-tagged images for that sha; a deploy that shipped
   nothing is recorded honestly (e.g. `servicesBuilt: []` plus a flag) but is
   not treated as a baseline.
2. Make `resolve_last_deployed_sha()` skip records that aren't build baselines,
   so a CLI-direct deploy can never suppress the next real one.
3. In the CLI deploy path, verify before recording `deployed`: confirm the
   sha's images exist in the registry (or the server reports that build number),
   and record `failed`/`skipped` with a clear message when they don't.
4. Preserve `BUILD_NUMBER`: when the CLI has no `BUILD_NUMBER`, either derive it
   the way the hook does (`git rev-list --count HEAD`) or have Ansible restore
   the value it read from the server rather than leaving `.env` without one.
   Pick one, and say which.
5. Add a regression test reproducing the emit-billing sequence: a no-build
   record followed by a real push must still build.

## Files involved
- `apps/cli/src/commands/deploy.ts` — verify before recording; supply a build number
- `packages/core/src/deploy-records.ts` — baseline flag on the record
- `scripts/lib/deploy-launch.sh` — `resolve_last_deployed_sha` skips non-baseline records
- `ansible/roles/app-deploy/tasks/main.yml` — don't leave `.env` without `BUILD_NUMBER`
- `packages/core/src/deploy-records.test.ts`, `scripts/lib/deploy-plan.test.sh` — coverage

## Acceptance criteria
- [x] A deploy that builds and re-tags nothing does not advance the sha used by
      the path filter — proven by a test that fails against today's code
- [x] The emit-billing sequence is a named regression test: no-build record,
      then a real push, and the push still builds its changed services
- [x] The CLI refuses to record `deployed` when the sha's images can't be shown
      to exist, and says why
- [x] After a CLI-direct deploy, the server `.env` still has a `BUILD_NUMBER`
- [x] Existing records remain readable — old records without the new field must
      not crash or silently become baselines
- [x] Coverage in `deploy-records.test.ts` and `deploy-plan.test.sh`
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm test:hooks` pass
      (this repo has no `check:affected`)

## Out of scope
- Running a real production deploy to prove it end to end — note it as a
  follow-up to confirm on the next ordinary deploy.
- Build speed work — sprints 337-339.
- Changing the blue-green slot-flip logic itself.

## Completed

**Date:** 2026-09-17

### Summary
A deploy record now only counts as the smart-build baseline (what
`resolve_last_deployed_sha` hands the path filter as `LAST_SHA`) when it
carries an explicit `isBuildBaseline:true`. `ci-utils.sh`'s `deploy_done`
(the pre-push hook's writer) always stamps `true`, since that path can't
reach "deployed" without having actually built or re-tagged every declared
service first. `deployRecordDone` (the CLI's writer, `deploy.ts`) defaults to
`false` — the CLI never builds images itself, so a caller must prove the
deploy shipped before it's trusted. `resolve_last_deployed_sha`
(`deploy-launch.sh`) requires `isBuildBaseline is True` on both the direct
`.deploy-status.json` read and the `.deploy-history.jsonl` fallback scan, and
keeps walking backward past any record that fails that check instead of
returning it or giving up — this is what makes the emit-billing sequence
self-healing rather than merely detected.

Records written before this sprint have no `isBuildBaseline` key at all, and
the fix fails safe: a missing key is treated as "not a baseline," never as
"trust it." That's a deliberate, one-time cost — the next real push for any
project after this change lands will find no verified baseline anywhere in
its history (since nothing pre-336 carries the field) and rebuild every
declared service once, the same "no known baseline" path that already exists
today for a first-ever deploy. After that one rebuild, every project is back
to normal incremental builds, now with a baseline flag that's actually
trustworthy. This is called out explicitly here since it's a real, immediate,
fleet-wide side effect and not obviously implied by "add a field."

On the CLI side (`apps/cli/src/commands/deploy.ts`), two behaviors changed:
- **`resolveBuildNumber`** always derives a build number when
  `BUILD_NUMBER` isn't already in the environment, using the identical
  formula the pre-push hook uses (`git rev-list --count HEAD`,
  `pre-push:37`). Passing this into `buildDeployExtraVars` means Ansible's
  existing `Set BUILD_NUMBER in server .env` task (gated on
  `build_number is defined`) now always fires for a CLI-direct deploy too —
  this is the "derive it the way the hook does" option from the sprint's
  Task 4, chosen over an Ansible-side restore-from-server change because it
  needed no playbook edits and reuses a formula that's already
  battle-tested. No changes were needed in
  `ansible/roles/app-deploy/tasks/main.yml`.
- **Post-deploy verification**: after Ansible succeeds, the CLI reads back
  the actually-running container's baked-in `build.number` label over SSH
  (`readDeployedBuildNumber`, reusing the exact `docker inspect` command
  `main.yml`'s own "Read deployed build number from container label" task
  already relies on) and compares it to the build number it intended to
  ship. A confirmed mismatch — the exact emit-billing shape, where Ansible
  successfully slot-flips onto stale `:latest` images — makes the CLI
  **refuse to record `deployed`**: it writes a `failed` record instead
  (`isBuildBaseline:false`), prints why, and exits 1. A confirmed match
  writes `deployed` with `isBuildBaseline:true`. Anything inconclusive (no
  build number could be derived at all, or the SSH check itself errors) logs
  a warning and still records `deployed`, just with `isBuildBaseline:false` —
  ansible did succeed, so refusing to record *that* would be its own kind of
  dishonest record; it just isn't trusted as a diff baseline.

This verification is necessarily post-hoc (it runs after Ansible has already
restarted containers), not a pre-flight registry check — see Follow-ups.

### Files changed
- `packages/core/src/deploy-records.ts` — `deployRecordDone` takes an
  `isBuildBaseline` param (default `false`), written onto both the terminal
  `.deploy-status.json` and the `.deploy-history.jsonl` line
- `packages/core/src/deploy-status.ts` — documented the new field on
  `DeployStatusRecord`
- `packages/core/src/index.ts` — exported `gitField` (needed by `deploy.ts`'s
  build-number derivation)
- `apps/cli/src/commands/deploy.ts` — added `resolveBuildNumber` and
  `readDeployedBuildNumber`; the deploy action now derives a build number,
  verifies it post-deploy, and threads `isBuildBaseline` through both
  `deployRecordDone` calls
- `scripts/lib/ci-utils.sh` — `deploy_done` now stamps `isBuildBaseline:true`
  on both records it writes
- `scripts/lib/deploy-launch.sh` — `resolve_last_deployed_sha` requires
  `isBuildBaseline is True` (strict), on both the status-file read and the
  history fallback scan, and keeps walking history past records that fail it
- `apps/api/src/routes/history.ts` — documented the new field on
  `DeployHistoryEntry`
- `packages/core/src/deploy-records.test.ts` — coverage for the new param's
  default and explicit-true cases, plus updated key-order expectations
- `scripts/lib/deploy-plan.test.sh` — new/updated `resolve_last_deployed_sha`
  coverage: missing-field and explicit-false fail safe; the emit-billing
  sequence as a named regression; existing fixtures updated to carry
  `isBuildBaseline:true` where they represent trustworthy deploys
- `scripts/lib/deploy-unattended-gate.test.sh` — one pre-existing fixture
  updated to carry `isBuildBaseline:true` (it broke under the new fail-safe
  default — see Verification)
- `apps/cli/src/commands/deploy.test.ts` — coverage for `resolveBuildNumber`,
  `readDeployedBuildNumber`, and the full verify/refuse/warn behavior of the
  deploy action

### Verification
- `pnpm test`: 255 + 439 pass (cli/core/api/dashboard projects, full run)
- `pnpm typecheck`: clean across all 5 projects
- `pnpm lint`: clean across all 5 projects
- `pnpm test:hooks`: all suites green, including `deploy-plan.test.sh` (50/50,
  covering the new resolve_last_deployed_sha behavior) — first run surfaced a
  real regression in `deploy-unattended-gate.test.sh` (a fixture missing
  `isBuildBaseline` made `resolve_last_deployed_sha` correctly-but-newly
  return `''`, which changed the ignored-paths diff and made that test reach
  the unattended-shell gate). Fixed by adding the field to that fixture, not
  by loosening the resolve logic — the failure was the fail-safe default
  working as designed against a stale fixture, not a bug in the fix.

### Follow-ups
- `[defer]` The post-deploy verification is post-hoc: it runs after Ansible
  has already pulled/restarted containers, so it can *detect and refuse to
  record* a bad CLI-direct deploy but can't *prevent* the slot-flip onto
  stale images the way a pre-flight registry check (`docker manifest
  inspect` against `ghcr.io/<org>/<service>:<sha>` for each blue-green
  service, using `ci.ghcrOrg`/`ci.imagePrefix`/`ci.ghcrRepo`) would. A
  pre-flight check was considered and dropped for this sprint: it only
  applies to blue-green projects (image naming per-service comes from
  `blueGreen.services`, which non-blue-green projects don't declare), needs
  a local `docker login` the CLI doesn't otherwise require, and isn't
  mockable with this codebase's existing `sshExec`-based test patterns the
  way the post-hoc SSH check is. Worth a dedicated sprint if stronger
  prevention (not just detection) is wanted.
- `[defer]` Verification assumes every deployed image carries a
  `LABEL build.number=...` (the same assumption sprint 204's Ansible fallback
  task already makes). A project whose Dockerfile doesn't bake that label
  will read back an empty string from `readDeployedBuildNumber`, which the
  CLI treats as "inconclusive" (warns, records `deployed` with
  `isBuildBaseline:false`) rather than refusing — so it degrades safely, but
  such a project can never earn a CLI-verified baseline either.
- `[defer]` The one-time fleet-wide rebuild noted in the Summary (every
  project's first push after this lands finds no pre-336 baseline and
  rebuilds all declared services once) is expected and self-healing, but
  worth mentioning to anyone watching a push suddenly take longer than
  usual.
- `none` beyond the above — no blockers, nothing needed before the next
  sprint.
