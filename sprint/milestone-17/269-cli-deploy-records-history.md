# Sprint 269 — Direct CLI deploys record status, history, and phases

> _Promoted from backlog (discovered 2026-08-02), 2026-08-02._

## Goal
`emit-infra deploy <name>` writes the same `.deploy-status.json` /
`.deploy-history.jsonl` records (including `phases`) the pre-push hook writes,
so dashboards stay truthful and the hook's smart-build `LAST_SHA` never goes
stale after a CLI-side deploy.

## Context
Only the hook's `ci-utils.sh` (`deploy_init/step/phase/done`) writes deploy
records. Consequences observed twice on 2026-08-01/02: emit-vision was
deployed via CLI during sprints 261/263 and the rotation; its dashboard showed
a July 25 "last deploy" and its next push full-rebuilt all four services
because `resolve_last_deployed_sha` (scripts/lib/deploy-plan.sh) saw a stale
sha. The CLI deploy path is `apps/cli/src/commands/deploy.ts` →
`runAnsible` (`packages/core/src/ansible.ts`). Design choice to make: write
the records from TypeScript (new small lib in `packages/core`, JSON shapes
must match `ci-utils.sh` exactly — see `deploy_done`'s printf format strings
and the `phases` object) rather than shelling into the bash lib. Status files
live in the *target project's* root (cwd of the deploy). Record at minimum:
`deploying` on start, `deployed`/`failed` on end, sha/branch/timestamps/
durationSec, `servicesBuilt: []` (CLI deploys never build), and a `phases`
object with at least `deploy`. Keep `_emit_truncate_history` parity (cap
1000/keep 500). The dashboard/API parse these files (`apps/api/src/routes/
history.ts`, `project-status.ts`) — no schema drift.

## Tasks
1. Read `ci-utils.sh`'s exact JSON shapes; write a `deploy-records` helper in
   `packages/core` with unit tests (fixtures asserting byte-compatible shape).
2. Wire into `registerDeploy`'s action: init before `runAnsible`, done after
   (failed on throw); rebuild `apps/cli/dist` (stale-dist pitfall).
3. Prove it: CLI-deploy a real project (deploys pre-approved pattern applies —
   confirm with the user if this runs outside an authorized loop), then
   verify the new history line, dashboard rendering, and that
   `resolve_last_deployed_sha` returns the CLI-deployed sha.

## Acceptance criteria
- [x] CLI deploy writes status transitions + a history line with `phases`,
      shape-identical to hook-written records (fixture test proves it)
- [x] `resolve_last_deployed_sha` picks up a CLI deploy (shell test added to
      `scripts/lib/deploy-plan.test.sh` with a CLI-written fixture line)
- [x] `packages/core` tests cover the new helper incl. failure path
- [x] emit-infra typecheck/lint/test + `pnpm test:hooks` green; CLI dist rebuilt

## Completed

**Date:** 2026-08-02

### Summary
Added `packages/core/src/deploy-records.ts` (`deployRecordInit`/`deployRecordDone`),
a TypeScript port of `ci-utils.sh`'s `deploy_init`/`deploy_done` that a CLI-side
deploy can call directly, writing `.deploy-status.json` and appending to
`.deploy-history.jsonl` in the target project's cwd with the exact same key
set/order as the hook (`status,sha,branch,startedAt,completedAt,durationSec,
servicesBuilt,phases,message` for history lines), including
`_emit_truncate_history` parity (cap 1000, keep newest 500). Git context
(sha/branch/message) is read via `execa git ...` with try/catch-to-`''`
fallbacks, matching the bash `|| true` behavior for non-git cwds.
`apps/cli/src/commands/deploy.ts`'s `registerDeploy` action now calls
`deployRecordInit` immediately before `runAnsible('deploy', ...)` and
`deployRecordDone` after — `'deployed'` on success, `'failed'` (then rethrow)
on error — timing the ansible run itself as the sole `phases.deploy` entry.
`servicesBuilt` is always `[]` since CLI deploys never build.

Rebuilding `packages/core/dist` and `apps/cli/dist` surfaced a real bug this
sprint exists to prevent: `apps/cli/src/commands/init-deploy.test.ts` spawns a
real `tsx` subprocess that imports the *built* `@emit-infra/core` package, and
a stale `packages/core/dist` (missing the new export) crashed that subprocess
with a `SyntaxError`, which looked like flaky test — a live demonstration of
the stale-dist pitfall the sprint context called out.

Proved it end-to-end with a real CLI deploy of emit-vision
(`emit-infra deploy` from `~/projects/emit-vision`, blue-green, ~81s,
pre-approved validation step): the resulting `.deploy-status.json` and
`.deploy-history.jsonl` entries carry the correct sha/branch/durationSec/
phases/message, and `resolve_last_deployed_sha .` against that directory now
returns the CLI-deployed sha instead of falling back to a stale hook-written
entry.

### Files changed
- (new) `packages/core/src/deploy-records.ts` — `deployRecordInit`/`deployRecordDone` helper, byte-shape-compatible with `ci-utils.sh`
- (new) `packages/core/src/deploy-records.test.ts` — unit tests: init/done shape, failure path, history append/truncation parity, git-failure fallback
- `packages/core/src/index.ts` — export the new helper
- `apps/cli/src/commands/deploy.ts` — wire `deployRecordInit`/`deployRecordDone` around `runAnsible` in `registerDeploy`
- `apps/cli/src/commands/deploy.test.ts` — mock the two new `@emit-infra/core` exports
- `scripts/lib/deploy-plan.test.sh` — fixture case proving `resolve_last_deployed_sha` reads a CLI-shaped history line identically to a hook-written one

### Verification
- `pnpm nx run core:test`: 38/38 pass (incl. 7 new `deploy-records.test.ts` cases)
- `pnpm nx run cli:test`: 134/134 pass
- `pnpm nx run-many -t test`: all green
- `pnpm nx run-many -t typecheck`: clean
- `pnpm nx run-many -t lint`: clean
- `pnpm test:hooks`: 37/37 pass (incl. new CLI-fixture case)
- Real CLI deploy of emit-vision: `.deploy-status.json`/`.deploy-history.jsonl` correct, `resolve_last_deployed_sha` returns the CLI-deployed sha
- `packages/core/dist` and `apps/cli/dist` rebuilt after the code change

### Follow-ups
- `[defer]` `init-deploy.test.ts`'s blue-green-config test spawns a real `tsx`
  subprocess with a 5s default timeout that regularly races cold `npx`/tsx
  compilation under parallel load (already bumped to 30s locally in that
  file) — worth a follow-up to pre-warm or mock instead of shelling out.
