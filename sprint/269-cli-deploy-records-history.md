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
- [ ] CLI deploy writes status transitions + a history line with `phases`,
      shape-identical to hook-written records (fixture test proves it)
- [ ] `resolve_last_deployed_sha` picks up a CLI deploy (shell test added to
      `scripts/lib/deploy-plan.test.sh` with a CLI-written fixture line)
- [ ] `packages/core` tests cover the new helper incl. failure path
- [ ] emit-infra typecheck/lint/test + `pnpm test:hooks` green; CLI dist rebuilt
