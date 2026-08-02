# Cut the server-side deploy floor to under 90 seconds
**Difficulty:** 4

## Goal
Take a retag-only develemail deploy from ~209s to under ~90s by eliminating the
top server-side costs identified in sprint 253's `docs/DEPLOY-FLOOR.md`,
without changing blue/green deploy semantics.

## Reason
Every single deploy — even one that builds nothing — pays the full server-side
floor. At develemail's deploy frequency this is the largest remaining fixed
cost after the sprint 252 fixes, and unlike build time it applies to all
projects on the shared pipeline (develemail, emit-vision, diner-decider,
tastease, and soon emit-billing/emit-social). Sprint 253 produced per-task
data; this sprint acts on it.

## Context
**This sprint is data-driven: open `docs/DEPLOY-FLOOR.md` first** and attack
the measured top contributors, not this list. The suspects below are informed
guesses to evaluate against the data, roughly ordered by expected payoff:

1. **SSH round-trip overhead** — ~25 sequential tasks in
   `ansible/roles/app-deploy/tasks/main.yml`; at 2–4s/task that's 50–100s of
   pure overhead. Mitigations: `pipelining = True` + ControlPersist in
   `ansible.cfg` / `runAnsible` env; `gather_facts: false` in
   `ansible/playbooks/deploy.yml` if facts aren't used (grep the role for
   `ansible_facts` / `ansible_` vars first).
2. **Unconditional per-deploy copies** — compose files, health-check script,
   blue-green script, blue-green compose files are copied every deploy. Ansible
   `copy` is checksum-idempotent but each is still a task round-trip. Options:
   consolidate small copies into one `copy` with `loop` (fewer tasks ≠ fewer
   checksums, but pipelining amortizes), or gate rarely-changing script copies
   behind a role var/tag.
3. **Health-check polling** inside the server-side blue-green script — check
   its poll interval/timeout; a conservative `sleep 5`-per-iteration loop can
   add tens of seconds after the service is already healthy. Tighten intervals;
   do not weaken the pass criteria.
4. **`docker pull` behavior** — retag-only deploys pull an image whose layers
   already exist server-side; confirm pull is layer-cached (should be fast) vs
   re-pulling. Check what the blue-green script pulls and whether `:latest`
   vs `:BUILD_NUMBER` tags cause redundant pulls.
5. **Dangling-image prune** (`Remove dangling images` task) — runs in the
   critical path; can move to fire-and-forget (`async` + `poll: 0`) since
   nothing downstream depends on it.
6. **Env backup chain** — stat + timestamp + backup + copy + BUILD_NUMBER set
   is 5 tasks; consider collapsing into one shell task *only if* the data says
   it matters (readability has value).

Hard constraints:
- **Blue/green semantics unchanged**: same slot alternation, same health gate
  before traffic switch, same rollback behavior on failed health check.
- The role serves all consuming projects and all three deploy modes
  (blue-green / zero-downtime / standard) — don't optimize one mode by
  breaking another. Grep `ansible/roles/app-deploy/tasks/` for conditionals
  keyed on mode.
- `ci.envFile` is the deploy source of truth (project memory): the env
  copy/backup chain must keep working exactly as before.
- CLI dist pitfall: if `deploy.ts`/`ansible.ts` change, rebuild `apps/cli/dist`
  before any real deploy test.

## Tasks
1. Read `docs/DEPLOY-FLOOR.md`; write a short plan mapping each top cost to a
   mitigation (or a reasoned "leave it").
2. Implement the mitigations in emit-infra (ansible config, playbook, role
   tasks, and/or the server-side blue-green script).
3. `ansible-playbook --syntax-check` the deploy playbook; run
   `packages/core` tests; shellcheck/`bash -n` any touched shell scripts.
4. Commit, then measure: retag-only develemail deploy
   (`sprint/*.md`-only commit + `EMIT_FORCE_DEPLOY=1` push). Compare per-task
   timings against the sprint 253 baseline.
5. Run one normal code-touching deploy to confirm the with-build path and
   health-gated traffic switch still behave correctly (watch the log for the
   health-check pass before the nginx switch).
6. Deploy one *other* wired project (emit-vision or tastease — whichever is
   cheapest to push safely) to confirm no project-specific regression.
7. Update `docs/DEPLOY-FLOOR.md` with the after numbers, and
   `docs/PRE-PUSH-HOOK.md` if any new config knob was added.
8. If the 1500s outlier's cause became evident from the data, note it in the
   findings; still don't chase it beyond a note.

## Files involved
- `ansible.cfg` or `packages/core/src/ansible.ts` — pipelining, ControlPersist,
  callback config
- `ansible/playbooks/deploy.yml` — `gather_facts`, play-level settings
- `ansible/roles/app-deploy/tasks/main.yml` — task consolidation/gating,
  async prune
- `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` and the blue-green
  script it ships — health-check poll tuning, pull behavior
- `docs/DEPLOY-FLOOR.md` — after-numbers update
- `docs/PRE-PUSH-HOOK.md` — only if config surface changes
- `~/projects/develemail`, plus one of emit-vision/tastease — measurement +
  regression targets

## Acceptance criteria
- [x] Retag-only develemail deploy floor substantially reduced, with the
      per-task log proving where the savings came from — **measured 118s from
      the 249s baseline (52.6% cut). Original <90s stretch target not met;
      user accepted 118s on 2026-08-01 (remaining gap is per-task Ansible
      dispatch overhead; the two candidate optimizations are filed as
      follow-ups for later). See `docs/DEPLOY-FLOOR.md`.**
- [x] With-build deploy still: health-checks before switching traffic, switches
      slots correctly, and ends `deployed`
- [x] A second project deploys successfully with no behavior change
- [x] Blue/green script changes (if any) reviewed line-by-line against the
      rollback path — a failed health check still aborts the switch (describe
      the verification in completion notes; force a failure locally if feasible)
- [x] Test coverage: `packages/core/src/ansible.test.ts` covers any `ansible.ts`
      changes; `scripts/lib/deploy-plan.test.sh` still passes; any new shell
      logic extracted to a testable lib gets cases added
- [x] emit-infra typecheck/lint/test green; `ansible-playbook --syntax-check`
      clean

## Out of scope
- Build-time work (QEMU, caching) — sprint 255
- Restructuring the role layout or deploy modes
- The provisioning playbook
- Chasing the 1500s outlier beyond documenting evidence

## Completed

**Date:** 2026-08-01

### Summary
Attacked the sprint 253 per-task data in ranked order: enabled SSH pipelining
+ ControlPersist (`packages/core/src/ansible.ts`), made the dangling-image
prune fire-and-forget (`async: 60` / `poll: 0`), and instrumented
`blue-green-deploy.sh` with internal `date +%s` timing markers around
pull/start/health-check/nginx-switch/stop-old. Measured 3 develemail deploys
(1 retag-only, 2 with-build) plus 1 tastease deploy (`composeStructure:
profiles`, a different code path than develemail's `separate`) against the
sprint 253 baseline. Result: **retag-only floor 249s → 118s (52.6%
reduction)**; with-build 241-243s → 123-126s (~48%). Blue/green semantics
(health-gated switch, correct slot alternation, rollback-on-failure) verified
unaffected in both `composeStructure` modes.

The original <90s stretch target was not met — closest run is 28s over. The
user reviewed the data and accepted 118s in place of the stretch target on
2026-08-01: the remaining gap is per-task Ansible dispatch overhead (each
of ~20 critical-path tasks pays a fixed remote-module-dispatch + checksum
cost that pipelining halves but doesn't eliminate), not a bug or an
unexplored lever. The acceptance criterion above has been amended to record
the measured number and the user's sign-off rather than left unmet.

Investigated the next-biggest lever — consolidating develemail's 7-item
"Copy extra files" loop into directory copies — and found a real landmine:
`infra/opendkim/key.table` + `signing.table` are written at runtime by the
live API container (per `entrypoint.sh`'s own comment), so a naive directory
copy would silently overwrite live DKIM key state with stale repo content on
every deploy. Did not make that change. `infra/postfix/`'s 4 files have no
such risk and could safely collapse to one directory-copy task (~10-15s
saved) — filed as a follow-up rather than rushed in, since it's a
develemail-config-only change outside this sprint's file list. The other
data-backed lever — `blue-green-deploy.sh`'s new timing markers showing
`stop_old` (old-slot `docker compose stop`) at 11s on develemail vs 1s on
tastease, lining up with Docker's default 10s SIGTERM grace period — was
also deliberately left alone: shortening it trades deploy speed for a small
per-deploy risk of killing an in-flight `worker` job, and that tradeoff
needs the worker's actual graceful-shutdown behavior verified first, not a
blind timeout cut on a role shared by every project on the pipeline.

### Files changed
- `packages/core/src/ansible.ts` — inject `ANSIBLE_SSH_PIPELINING=True` +
  `ANSIBLE_SSH_CONTROL_PERSIST=60s`, matching the existing
  `ANSIBLE_HOST_KEY_CHECKING` env-var pattern
- `packages/core/src/ansible.test.ts` — coverage for the new pipelining env
  vars
- `ansible/roles/app-deploy/tasks/main.yml` — "Remove dangling images" made
  `async: 60` / `poll: 0` (fire-and-forget)
- `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` and the server-side
  blue-green script — `date +%s` timing markers around pull/start/
  health-check/nginx-switch/stop-old
- `docs/DEPLOY-FLOOR.md` — new "Sprint 254 results" section: before/after
  table, per-task recap, `stop_old` finding, and the reasoning for not
  chasing <90s further

### Verification
- `packages/core` (`nx run core:test`, vitest): 31/31 pass (includes new
  `ansible.test.ts` pipelining-env case)
- `nx run core:lint`: clean
- `tsc --noEmit -p packages/core/tsconfig.json`: clean
- `ansible-playbook --syntax-check ansible/playbooks/deploy.yml`: clean
- `scripts/lib/deploy-plan.test.sh`: 36/36 pass
- Real deploys: 3 develemail (1 retag-only, 2 with-build) + 1 tastease,
  all ended `deployed`; health-gate-before-switch and correct slot
  alternation confirmed in the deploy log for both `composeStructure` modes
  (`separate` on develemail, `profiles` on tastease); no rollback path
  exercised in these runs (all health checks passed), but the script's
  rollback branch was reviewed line-by-line and is unchanged from sprint
  253's verified behavior
- `apps/cli/dist` rebuilt before every real deploy test (stale-dist project
  memory)

### Follow-ups
- `[defer]` Consolidate develemail's `infra/postfix/` 4-file `extraFiles`
  loop into a single directory `copy` task (~10-15s saved). Safe —
  unlike `infra/opendkim/`, postfix has no runtime-written files. Scoped to
  develemail's own config (`extraFiles` is per-project JSON), not shared
  role code.
- `[defer]` Verify develemail's `worker` service's `SIGTERM` shutdown
  behavior, then consider shortening the old slot's `docker compose stop`
  timeout (currently Docker's 10s default, observed as an 11s `stop_old`
  cost on develemail vs 1s on tastease). Do this verification before
  touching the timeout — a blind cut risks killing an in-flight worker job,
  and the role is shared by every project on the pipeline.
- `[defer]` Consider `ansible.posix.synchronize` (rsync) for the per-file
  copy tasks if a bigger win is wanted later — pipelining alone only halves
  (doesn't eliminate) per-file copy overhead, and rsync would be a bigger
  shared-role blast radius worth its own sprint.
