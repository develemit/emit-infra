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
- [ ] Retag-only develemail deploy measured at <90s total deploy phase (from
      `.deploy-history.jsonl` `phases.deploy` + retag), with the per-task log
      proving where the savings came from
- [ ] With-build deploy still: health-checks before switching traffic, switches
      slots correctly, and ends `deployed`
- [ ] A second project deploys successfully with no behavior change
- [ ] Blue/green script changes (if any) reviewed line-by-line against the
      rollback path — a failed health check still aborts the switch (describe
      the verification in completion notes; force a failure locally if feasible)
- [ ] Test coverage: `packages/core/src/ansible.test.ts` covers any `ansible.ts`
      changes; `scripts/lib/deploy-plan.test.sh` still passes; any new shell
      logic extracted to a testable lib gets cases added
- [ ] emit-infra typecheck/lint/test green; `ansible-playbook --syntax-check`
      clean

## Out of scope
- Build-time work (QEMU, caching) — sprint 255
- Restructuring the role layout or deploy modes
- The provisioning playbook
- Chasing the 1500s outlier beyond documenting evidence
