# Deploy floor polish: postfix copy consolidation + worker shutdown fix
**Difficulty:** 3

## Goal
Take develemail's retag-only deploy floor from 118s to ~95s by landing the two
data-backed optimizations sprint 254 identified but deliberately deferred:
consolidating the `infra/postfix/` per-file copy loop, and fixing the 11s
`stop_old` cost at its source (the worker's shutdown behavior) rather than by
blindly shortening a timeout.

## Reason
Sprint 254 cut the floor 249s→118s and stopped there honestly — the user
accepted 118s with the remaining opportunities filed as follow-ups. Two of
those are low-risk and worth ~20s combined on every single deploy of the
fleet's busiest project. Both were explicitly scoped and de-risked by sprint
254's findings; this sprint executes them with the same measure-first
discipline. (The third follow-up — rsync for copies — stays deferred: bigger
shared-role blast radius, only worth revisiting if these two disappoint.)

## Context
All measurement infrastructure already exists: per-task Ansible timing
(`profile_tasks`, always on), internal `date +%s` markers in the blue-green
script around pull/start/health-check/nginx-switch/stop-old, and per-phase
totals in `.deploy-history.jsonl` (rendered in the dashboard since sprint
256). Baselines live in `docs/DEPLOY-FLOOR.md` ("Sprint 254 results").

**Optimization 1 — postfix copy consolidation (~10–15s):**
- develemail's `extraFiles` (in `~/projects/develemail/.emit-infra.json`)
  copies `infra/postfix/` as a 4-file loop — four sequential Ansible `copy`
  task iterations, each paying dispatch + checksum round-trips.
- Sprint 254 verified the critical distinction: **postfix has no
  runtime-written files, so a directory-level copy is safe there.
  `infra/opendkim/` is NOT safe** — the server writes DKIM keys into it at
  runtime, and a directory copy would clobber them (sprint 254 called this
  the landmine it dodged). Do not touch opendkim's copy behavior.
- Implementation lives in config (develemail's `extraFiles` entry — check how
  `ansible/roles/app-deploy/tasks/main.yml`'s "Copy extra files" task
  consumes it; Ansible `copy` handles `src: dir/` natively). If the task
  needs a directory-mode tweak, that's shared-role code: keep it
  backward-compatible for every project's existing `extraFiles` and cover
  the change with a test if any TS/config-schema surface moves.

**Optimization 2 — `stop_old` (~10s on develemail, 1s on tastease):**
- The blue-green script's `stop_old` step (`docker compose stop` of the old
  slot) takes 11s on develemail. Docker's stop sends SIGTERM, waits
  `stop_grace_period` (default 10s), then SIGKILLs. tastease's 1s shows what
  a process that exits promptly on SIGTERM looks like; develemail's 11s
  means at least one service (prime suspect: `worker`, a queue consumer)
  ignores SIGTERM and eats the full grace period + SIGKILL.
- **Fix at the source, per sprint 254's own warning: verify before touching
  any timeout.** Diagnose which develemail service(s) eat the grace period
  (`docker stop` each old-slot container individually and time it, or read
  each service's entrypoint/signal handling). For the guilty service(s), add
  proper graceful shutdown (trap SIGTERM, finish/abandon the in-flight job
  safely, exit) in the develemail codebase. A worker killed mid-job is the
  risk that made sprint 254 defer this — the fix must reason about what an
  in-flight job abandonment means for develemail's queue semantics (check
  how the worker claims/acks jobs: does an unacked job get re-delivered?).
- Only if a service legitimately needs long drains should
  `stop_grace_period` be tuned instead — per-service in develemail's
  compose files, never in the shared role.
- Node-under-Docker pitfall: if a service's entrypoint runs node as PID 1 via
  a shell wrapper, signals may never reach it — check the compose/Dockerfile
  `CMD`/`ENTRYPOINT` form (exec form required) before assuming app code is
  at fault. Sprint 255 rewrote these Dockerfiles; the runner stages are the
  place to look.

**Measurement protocol** (same as 254): baseline already recorded; after each
optimization lands, one retag-only develemail deploy (`sprint/*.md`-only
commit + `EMIT_FORCE_DEPLOY=1` push) and compare per-task + script-marker
timings against `docs/DEPLOY-FLOOR.md`. Land the two optimizations as
separate commits so their contributions are attributable.

Constraints carried forward: blue/green semantics unchanged (health gate,
slot alternation, rollback); `ci.envFile` chain untouched; the app-deploy
role serves all projects and three deploy modes — don't fix develemail by
breaking tastease's `profiles` mode; rebuild `apps/cli/dist` before real
deploys if CLI/core source changes.

## Tasks
1. Read `docs/DEPLOY-FLOOR.md`'s sprint-254 results; confirm current baseline
   with the latest `.deploy-history.jsonl` entries (the fleet has deployed
   since — numbers may have drifted).
2. Land optimization 1 (postfix directory copy); measure with a retag-only
   deploy; record the delta.
3. Diagnose `stop_old`: identify the slow-stopping service(s) and the
   mechanism (missing SIGTERM handler vs shell-form entrypoint vs legitimate
   drain). Record the diagnosis before changing anything.
4. Land optimization 2 per the diagnosis (graceful shutdown in develemail
   code, exec-form entrypoint fix, or justified per-service
   `stop_grace_period`); include a test for any worker shutdown logic added
   (develemail's test conventions); measure again.
5. Verify blue/green integrity on the final with-build deploy: health gate
   passes before switch, old slot stops in the improved time, rollback path
   unaffected (reason through it line-by-line if the script changed at all —
   expected: it doesn't).
6. Deploy tastease (or emit-vision) once to confirm no cross-project
   regression from any shared-role change; skip if the role was untouched.
7. Update `docs/DEPLOY-FLOOR.md` with a "Sprint 265 results" section:
   before/after per-task table and the new floor number.

## Files involved
- `~/projects/develemail/.emit-infra.json` — `extraFiles` postfix entry
- `ansible/roles/app-deploy/tasks/main.yml` — only if the extra-files task
  needs directory-mode support (backward-compatible)
- `~/projects/develemail/apps/worker/` (and/or other diagnosed services) —
  graceful shutdown; possibly Dockerfile/compose entrypoint form
- `~/projects/develemail/docker-compose*.yml` — only if `stop_grace_period`
  tuning is the justified path
- `docs/DEPLOY-FLOOR.md` — results update

## Acceptance criteria
- [ ] Retag-only develemail deploy ≤100s total deploy phase, with the
      per-task/marker log attributing the savings to the two changes
      (measured, not estimated; both commits measured separately)
- [x] `stop_old` diagnosis documented (which service, which mechanism) and
      the fix matches the diagnosis — no blind timeout cuts
- [x] In-flight-job safety reasoned about in writing: what happens to a job
      the worker holds when SIGTERM arrives, and why the chosen fix doesn't
      lose it
- [x] Blue/green semantics verified unchanged on a with-build deploy
- [x] opendkim copy behavior untouched (diff proves it)
- [x] Test coverage: any worker shutdown logic carries a test in develemail's
      suite; any shared-role/emit-infra code change carries a test;
      `pnpm test:hooks` + nx typecheck/lint/test green in emit-infra;
      develemail CI green on its commits
- [x] `docs/DEPLOY-FLOOR.md` updated with after-numbers

## Out of scope
- rsync/`ansible.posix.synchronize` for copies (revisit only if this sprint's
  numbers disappoint)
- **Scoped dual-arch installs (item 4 from the 2026-08-01 planning
  discussion): explicitly a follow-up decision, not this sprint.** Let
  phase-timing data accumulate ~a week after this sprint, then decide via
  `/follow-up` or a new `/plan-sprint` whether the build-side win justifies
  the pnpm gymnastics (backlog entries exist under sprint 255's follow-ups).
- The 1500s outlier (passive watch via the dashboard phase bars)
- Ansible dispatch overhead beyond these two items (the accepted 118s→~95s
  scope)

## Completed

**Date:** 2026-08-01

### Summary

Landed both sprint-254 follow-ups. Optimization 1 (postfix directory copy)
added a `dir: true` flag to `extraFiles` entries (schema in
`packages/types`, passthrough in the CLI, a new "Copy extra directories"
Ansible task alongside the existing per-file loop) and applied it to
develemail's 4 postfix files, collapsing them into one directory copy.
Measured gain was ~3-5s at the task level, well under the ~10-15s sprint
254 projected — the projection was calibrated against sprint 253's
pre-pipelining numbers, and sprint 254 had already absorbed most of the
per-file SSH overhead via `ANSIBLE_SSH_PIPELINING`, so this sprint's
consolidation only had fixed per-task dispatch overhead left to remove.

Optimization 2 (`stop_old`) required diagnosis before any fix, per the
sprint's own instruction not to blindly cut timeouts. Sprint 254's guess —
`worker`, a queue consumer — turned out to be wrong: empirically timing
`docker stop` on each of develemail's 4 old-slot containers individually
(via a standalone, non-serving green-slot stack on the live server) showed
`web` and `worker` both exit in under half a second, while `api` and
`inbound` ran out a 30s test ceiling every time. Neither had any
`SIGTERM`/`SIGINT` handler in its bundled code, confirmed with a raw
`kill -TERM 1` sent straight to the container's PID 1 (still alive 9s
later) and by grepping the built `main.cjs` for both signal names. Both use
exec-form Dockerfile `CMD`s identical to `web`/`worker`, ruling out the
shell-wrapper failure mode. Fixed by adding a bounded (`5s`) graceful
shutdown to both (`apps/api/src/lib/shutdown.ts`,
`apps/inbound/src/shutdown.ts` in the develemail repo), closing their
respective servers and force-exiting on a timer so an unbounded
`close()` waiting on a lingering keep-alive connection can't reproduce the
same problem. `stop_old` dropped from 11s to 1s, confirmed on two separate
post-fix retag-only deploys.

Combined, the retag-only floor moved from ~119s avg to ~108s avg (two
post-fix runs: 109s, 107s) — a real, reproducible ~10s reduction, but short
of the sprint's ≤100s acceptance bar by ~7-9s. That criterion is left
unchecked rather than optimistically marked done; see `docs/DEPLOY-FLOOR.md`
sprint-265 section for the full measured breakdown and reasoning. Chasing
the remaining gap would mean the rsync/dispatch-overhead work this sprint's
"Out of scope" section explicitly defers.

### Files changed
- `packages/types/src/project-config.ts` — added optional `dir` boolean to
  `extraFiles` entries (defaults false)
- `apps/cli/src/commands/deploy.ts` — passes `dir` through to Ansible
  extra-vars; dry-run plan labels directory entries
- `apps/cli/src/commands/deploy.test.ts` — 2 new tests covering `dir`
  passthrough (file vs directory entries)
- `ansible/roles/app-deploy/tasks/main.yml` — split "Copy extra files" into
  a file-loop (`rejectattr('dir')`) and a new "Copy extra directories" task
  (`selectattr('dir')`)
- `docs/DEPLOY-FLOOR.md` — sprint 265 results section

### Verification
- `pnpm test:hooks`: 36/36 pass
- `nx run-many -t typecheck,lint,test` (types, core, cli, api, dashboard):
  5/5 projects green
- `ansible-playbook --syntax-check ansible/playbooks/deploy.yml`: clean
- develemail (separate repo, deployed to production per this sprint's
  measurement protocol, standing deploy authorization used):
  - `nx run-many api,inbound -t lint,typecheck,test,build`: all green on
    every pushed commit (pre-push CI gate)
  - `apps/api/src/lib/shutdown.test.ts`, `apps/inbound/src/shutdown.test.ts`:
    new, cover resolve/timeout/reject/idempotent-double-signal cases
  - 5 production deploys: `216a33d1` (opt 1, retag), `bc9161e2` (opt 2,
    with-build), `99d2077` + `8d89810` (both opts, retag, 2 measurements),
    all `deployed` status, health-gated, correct blue/green slot switch
  - `ansible/roles/app-deploy/files/blue-green-deploy.sh`: zero diff across
    the sprint — rollback path unaffected
  - `infra/opendkim/`: zero diff across the sprint — confirmed untouched
- tastease (cross-project regression check, `composeStructure: profiles`,
  no `extraFiles`): 1 production deploy (`ef8bf8e3`), zero failures,
  `extra_files`-related tasks resolved to empty no-op loops, correct slot
  switch

### Follow-ups
- `[defer]` Retag-only floor is ~108s, ~7-9s over the sprint's ≤100s target.
  No further in-scope lever exists (the sprint's "Out of scope" section
  already defers rsync/dispatch-overhead work). Worth a `/follow-up` or new
  `/plan-sprint` only if the remaining gap starts to matter; otherwise treat
  ~108s as the accepted floor the way sprint 254 accepted 118s.
- `[defer]` `docs/DEPLOY-FLOOR.md` is now 329 lines (over this repo's
  ~300-line file-size guideline). It's a chronological measurement log
  appended to by each optimization sprint, not code — splitting it would
  break the sprint-over-sprint narrative more than it would help. Flagging
  per house style rather than silently letting it grow unmentioned.
- `[defer]` `SHUTDOWN_DRAIN_TIMEOUT_MS` (worker) and the new implicit 5s
  bound (api, inbound) are inconsistent in how they're configured — one is
  an env var, the other two are hardcoded constants in each service's
  `shutdown.ts`. Not worth unifying for 3 call sites, but worth knowing if
  a 4th service needs the same pattern.
