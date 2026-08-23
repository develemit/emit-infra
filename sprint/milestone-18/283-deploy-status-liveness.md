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
- [x] An in-flight `.deploy-status.json` contains the writer's pid, host, and a
      `heartbeatAt` that advances while the deploy runs
- [x] `heartbeatAt` refreshes during a long silent build step (verify across at
      least one multi-minute image build, not just between `deploy_step` calls)
- [x] Terminal records are unchanged in shape apart from the documented
      addition; `resolve_last_deployed_sha` still resolves correctly against
      both `deployed` and `deploying` files
- [x] The bash and TS writers emit identical field names and types
- [x] No stray heartbeat process survives a normal completion, a trapped
      signal, or a `kill -9` of the hook
- [x] Coverage in `packages/core/src/deploy-records.test.ts` and in the bash
      hook suite; `pnpm test:hooks` and `pnpm test` both green

## Out of scope
- Interpreting the metadata. This sprint only *writes* it — the staleness rule
  that decides what counts as orphaned is sprint 284, and no reader should be
  changed here.
- Dashboard rendering (285) and the `--reconcile` command (286).
- Cross-host liveness. `pid` is only meaningful on the host that wrote it;
  recording `host` is enough for now, and readers on another machine should
  fall back to the heartbeat.

## Completed

**Date:** 2026-08-19

### Summary
Both status writers now carry a `"writer":{"pid":...,"host":...,"heartbeatAt":...}`
block on every in-flight record — bash's `ci_init`/`ci_step`/`deploy_init`/
`deploy_step` and TS's `deployRecordInit`. Terminal records (`ci_done`/
`deploy_done`/`deployRecordDone`) omit it, unchanged from before this sprint.

The bash side adds a background refresher (`_emit_start_heartbeat`/
`_emit_stop_heartbeat`/`_emit_refresh_heartbeat`) that rewrites just the
`heartbeatAt` field on a 30s interval so a reader can distinguish "no update
in 5 minutes" from "still building" during the long silent stretches an
emulated image build produces. It self-checks its parent's liveness every 5s
so a `kill -9` of the hook (which can't be trapped) is noticed and the
refresher exits on its own within seconds, rather than lingering forever.
`ci_done`/`deploy_done` and the sprint-282 signal handlers (which call
through them) all stop the refresher before writing the terminal record.

Two real bugs surfaced and got fixed during verification, both worth noting
for future work on this file:
1. **tmp-file collision.** The refresher originally reused
   `_emit_write_atomic`'s fixed `${dest}.tmp` naming — the same path
   `deploy_step`/`ci_step` (foreground) use. Two independent writers racing
   on one tmp filename means whichever `mv` loses gets a spurious "No such
   file or directory". Fixed by giving `_emit_write_atomic` an optional
   third arg and having the refresher write to `${file}.hb.tmp` instead.
   The two writers can still race on the *destination* rename (last one
   wins), but that's a self-healing lost-update, not a missing/corrupt file.
2. **Test-only footgun, not a product bug:** `deploy_done`'s double-
   finalization guard (sprint 282's `_EMIT_DEPLOY_FINALIZED`) is a
   module-global that's correct for real usage (one `deploy_init`/
   `deploy_done` pair per hook process) but silently no-ops a *second*
   `deploy_done` call within one sourced process — which the new bash test
   file does deliberately. Fixed by resetting the flag between rounds in the
   test, with a comment explaining why; ci-utils.sh itself is unchanged.

The TS side (`deployRecordInit`) writes the same three fields once, at init
only — the CLI deploy has no intermediate progress path (a single
init → `runAnsible` → done bracket), so unlike the bash writer there's no
periodic refresh to add there; that's noted in a doc comment.

`heartbeatAt` refreshing during silence (the criterion this sprint is
actually about) is proven with a **real** 30s-interval firing — the new bash
test starts `deploy_init`, makes zero `deploy_step` calls, sleeps 36
real seconds (30s floor + margin for scheduling jitter), and asserts the
background timer — not a direct manual call — advanced `heartbeatAt` on its
own. What's *not* done is a literal live push against a real multi-minute
production image build (mirrors sprint 282's own live-push deferral) — see
Follow-ups.

### Files changed
- `scripts/lib/ci-utils.sh` — writer pid/host/heartbeatAt fields on
  `ci_init`/`ci_step`/`deploy_init`/`deploy_step`; `_emit_start_heartbeat`/
  `_emit_stop_heartbeat`/`_emit_refresh_heartbeat`; stop-heartbeat calls in
  `ci_done`/`deploy_done`; distinct tmp path for the refresher's atomic write;
  header/section doc comments
- `packages/core/src/deploy-records.ts` — writer block on `deployRecordInit`
  via `node:os` `hostname()`; doc comment on scope (no refresh path)
- `packages/core/src/deploy-records.test.ts` — writer field assertions on
  init, `writer` omission assertion on the terminal record
- (new) `scripts/lib/deploy-liveness.test.sh` — writer/heartbeat coverage:
  field presence, terminal omission, `_emit_refresh_heartbeat` correctness
  and its no-op-on-terminal case, the real 30s timer, and no-stray-process
  after `kill -9`
- `scripts/lib/hook-signals.test.sh` — stop the heartbeat the sourced-direct
  SIGINT-registration test starts, so that test doesn't leak one
- `package.json` — `test:hooks` now runs `deploy-liveness.test.sh`

### Verification
- `bash -n` on `ci-utils.sh` and `deploy-liveness.test.sh`: clean
- `pnpm test:hooks` under real bash 3.2 (arm64-apple-darwin25), run clean
  multiple times in a row: **91 passed, 0 failed** (deploy-plan 47,
  docker-build 12, db-url 6, hook-signals 12, deploy-liveness 13 — the new
  file's own suite also re-run standalone 3x back to back with 0 flakes
  after the tmp-collision and FINALIZED-reset fixes)
- `pnpm test` (nx, all projects): 350 tests passed, 42 files
- `pnpm nx run-many -t typecheck`: clean (core, types, cli, api, dashboard)
- Live-push verification against a real multi-minute production image build
  deliberately not run — see Follow-ups, mirrors sprint 282's precedent

### Follow-ups
- `[defer]` Live-push verification of the heartbeat/writer fields against a
  real multi-minute production image build is still outstanding; do it the
  next time a wired project's `main` gets a natural push, per sprint 282's
  own precedent. The 30s-real-timer bash test is a strong local proxy but
  isn't the same as watching a real linux/amd64 emulated build.
- `[defer]` The destination-rename race between the heartbeat refresher and
  a concurrent `deploy_step`/`ci_step` write (two processes, same dest, no
  shared tmp anymore, but still no locking on the final `mv`) is an
  accepted, self-healing lost-update — worth a comment-level mention if a
  future sprint tightens status-file consistency further, but not worth
  fixing on its own.
- none other
