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
- [ ] A deploy that builds and re-tags nothing does not advance the sha used by
      the path filter — proven by a test that fails against today's code
- [ ] The emit-billing sequence is a named regression test: no-build record,
      then a real push, and the push still builds its changed services
- [ ] The CLI refuses to record `deployed` when the sha's images can't be shown
      to exist, and says why
- [ ] After a CLI-direct deploy, the server `.env` still has a `BUILD_NUMBER`
- [ ] Existing records remain readable — old records without the new field must
      not crash or silently become baselines
- [ ] Coverage in `deploy-records.test.ts` and `deploy-plan.test.sh`
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm test:hooks` pass
      (this repo has no `check:affected`)

## Out of scope
- Running a real production deploy to prove it end to end — note it as a
  follow-up to confirm on the next ordinary deploy.
- Build speed work — sprints 337-339.
- Changing the blue-green slot-flip logic itself.
