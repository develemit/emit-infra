# Write pid + heartbeat into the status files so orphaned deploys are detectable
**Difficulty:** 4

## Goal
`.deploy-status.json` and `.ci-status.json` carry enough liveness metadata —
the writer's pid, its hostname, and a periodically-refreshed heartbeat — that
any reader can tell an in-flight run from an orphaned one without guessing.

## Reason
Sprint 282 makes an interrupted hook mark itself, but only for signals it can
trap. `SIGKILL` cannot be trapped, and neither can a power loss, an OOM kill, or
a container teardown. In the 2026-08-19 emit-social incident the process was
killed outright: nothing ran, and `.deploy-status.json` sat at
`{"status":"deploying","progress":{"pct":66,...}}` indefinitely while no process
existed.

This is the sprint that actually covers that incident. Traps reduce how often it
happens; liveness metadata makes it *detectable* when it happens anyway. Without
it, "status says deploying" and "a deploy is running" are indistinguishable, and
every downstream reader — dashboard, CLI, `resolve_last_deployed_sha` — is
forced to trust a value that may be arbitrarily stale.

## Context
- **There are two writers of `.deploy-status.json` and they must stay in sync:**
  - `scripts/lib/ci-utils.sh` — bash, used by `scripts/hooks/pre-push`
    (`deploy_init` / `deploy_step` / `deploy_done`, and `ci_init` / `ci_step` /
    `ci_done` for the CI file)
  - `packages/core/src/deploy-records.ts` — TypeScript, used by
    `apps/cli/src/commands/deploy.ts` (`deployRecordInit` / `deployRecordDone`)

  The TS file's header comment already states it mirrors the bash shape
  deliberately. Any field added here goes in both, with the same names and the
  same JSON types. `packages/core/src/deploy-records.test.ts` covers the TS side.
- Both writers go through an atomic write (`_emit_write_atomic` in bash,
  `writeAtomic` in TS): write to `<dest>.tmp`, then rename. Keep that property —
  a reader must never see a half-written status file.
- Current in-flight shape (from `deploy_init`):
  ```json
  {"status":"deploying","sha":"...","branch":"main","startedAt":"2026-08-19T21:34:46Z",
   "progress":{"step":0,"total":3,"pct":0,"label":"starting"}}
  ```
  Terminal shape (from `deploy_done`) drops `progress` and adds `completedAt`.
- Heartbeat matters because a deploy has long silent stretches — an emulated
  linux/amd64 image build can run many minutes between `deploy_step` calls, so
  "last write time" alone would produce false orphan reports. A background
  refresher that touches the file on an interval is the reliable signal.
- If a background heartbeat process is used, it must be cleaned up on every
  exit path, including the signal handlers added in sprint 282, or the hook will
  leave stray processes behind. Coordinate with `_emit_flush_log`'s teardown.
- Bash 3.2 for the shell side. `$$` is the pid; prefer `$(hostname -s)` guarded
  with `|| true`.
- Do not change the meaning of existing fields — `resolve_last_deployed_sha` in
  `scripts/lib/deploy-plan.sh` reads `status` and `sha` and must keep working.

## Tasks
1. Decide and write down the schema addition. Suggested shape, in-flight only:
   `"writer":{"pid":12345,"host":"studio","heartbeatAt":"2026-08-19T21:41:02Z"}`.
   Terminal records don't need it. Document the choice in a comment in both
   writers.
2. Add the fields to the bash writer in `scripts/lib/ci-utils.sh` —
   `deploy_init`, `deploy_step`, `ci_init`, `ci_step`.
3. Add a heartbeat refresher that rewrites `heartbeatAt` on an interval
   (30s is a reasonable default) while a run is in flight, and stop it in
   `deploy_done` / `ci_done` and in the sprint-282 signal handlers. Make sure a
   killed parent doesn't leave the refresher running — it should exit when its
   parent is gone.
4. Mirror the same fields in `packages/core/src/deploy-records.ts`
   (`deployRecordInit`, and any progress update path the CLI deploy uses).
5. Extend `packages/core/src/deploy-records.test.ts` to assert the TS writer
   emits `writer.pid` / `writer.host` / `writer.heartbeatAt` on init and omits
   them on a terminal record.
6. Add a bash-side test asserting `deploy_init` writes a `writer` block whose
   pid matches the running shell, and that `deploy_done` writes a terminal
   record without one.
7. Confirm both writers still produce byte-compatible terminal records — run a
   real hook push and a real `emit-infra deploy` and diff the resulting
   `.deploy-history.jsonl` line shapes.

## Files involved
- `scripts/lib/ci-utils.sh` — add writer metadata to the four init/step
  functions; add and tear down the heartbeat refresher
- `packages/core/src/deploy-records.ts` — mirror the fields
- `packages/core/src/deploy-records.test.ts` — TS writer coverage
- `scripts/lib/deploy-plan.test.sh` (or the sprint-282 signal suite) — bash
  writer coverage
- `scripts/hooks/pre-push` — only if heartbeat start/stop needs an explicit call
  site outside `ci-utils.sh`

## Acceptance criteria
- [ ] An in-flight `.deploy-status.json` contains the writer's pid, host, and a
      `heartbeatAt` that advances while the deploy runs
- [ ] `heartbeatAt` refreshes during a long silent build step (verify across at
      least one multi-minute image build, not just between `deploy_step` calls)
- [ ] Terminal records are unchanged in shape apart from the documented
      addition; `resolve_last_deployed_sha` still resolves correctly against
      both `deployed` and `deploying` files
- [ ] The bash and TS writers emit identical field names and types
- [ ] No stray heartbeat process survives a normal completion, a trapped
      signal, or a `kill -9` of the hook
- [ ] Coverage in `packages/core/src/deploy-records.test.ts` and in the bash
      hook suite; `pnpm test:hooks` and `pnpm test` both green

## Out of scope
- Interpreting the metadata. This sprint only *writes* it — the staleness rule
  that decides what counts as orphaned is sprint 284, and no reader should be
  changed here.
- Dashboard rendering (285) and the `--reconcile` command (286).
- Cross-host liveness. `pid` is only meaningful on the host that wrote it;
  recording `host` is enough for now, and readers on another machine should
  fall back to the heartbeat.
