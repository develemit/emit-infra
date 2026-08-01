# Instrument the server-side deploy with per-task timing
**Difficulty:** 2

## Goal
Turn the opaque ~200s server-side deploy phase into a per-Ansible-task timing
breakdown, captured automatically on every deploy, and produce a findings doc
ranking where the time goes.

## Reason
develemail's deploy history shows a **~209s floor for a deploy that builds
nothing** (retag-only), and one 1500s retag-only outlier. The hook's new phase
timing (sprint 252) stops at `"deploy": <seconds>` — one number for the whole
`emit-infra deploy` invocation. Sprint 254 will optimize the server-side path,
and optimizing a black box guarantees wasted effort: the ansible role runs ~25
sequential tasks (`ansible/roles/app-deploy/tasks/main.yml`) and any of SSH
round-trips, file copies, docker pulls, health-check waits, or image pruning
could dominate. Measure first.

## Context
- Deploy chain: pre-push hook → `node apps/cli/dist/index.js deploy`
  (`apps/cli/src/commands/deploy.ts`) → `runAnsible('deploy', inventory,
  extraVars)` (`packages/core/src/ansible.ts`) →
  `ansible/playbooks/deploy.yml` → role `ansible/roles/app-deploy/`.
- Role task files: `main.yml` (~25 tasks: app dir, compose copy, env backup +
  copy, script copies, infra stack, slot init), then one of
  `deploy-blue-green.yml` / `deploy-zero-downtime.yml` / `deploy-standard.yml`,
  then `sync-vhost.yml`, version file, post-deploy commands, dangling-image
  prune.
- Ansible's built-in timing: the `ansible.posix.profile_tasks` callback prints
  per-task durations to stdout; `timer` prints playbook total. Enable via
  `ansible.cfg` (`callbacks_enabled`) or env var
  `ANSIBLE_CALLBACKS_ENABLED=ansible.posix.profile_tasks` set in `runAnsible`.
  Check whether an `ansible.cfg` exists in the repo or whether `runAnsible`
  passes env — prefer whichever the codebase already uses. If `ansible.posix`
  isn't installed, fall back to the older callback name `profile_tasks` or add
  the collection.
- Hook logs already tee to `.deploy-logs/<sha>.log` in the consuming project
  (`_emit_start_log` in `scripts/lib/ci-utils.sh`), so profile output lands in
  the log automatically once ansible emits it.
- A pure floor measurement: in develemail, commit a `sprint/*.md`-only change
  and push with `EMIT_FORCE_DEPLOY=1` — every service retags, so the deploy
  phase is 100% server-side overhead.
- Blue-green specifics live in a server-side script the role copies over
  (`Copy blue-green deploy script` task) — its internal waits (health-check
  polling loops) are invisible to Ansible task timing. If the blue-green task
  dominates, note that drilling into the script is sprint 254's job; if
  feasible, add coarse `date +%s` echo lines to the script's phases as part of
  this sprint.
- CLI dist pitfall (project memory): if `deploy.ts` or `ansible.ts` change,
  rebuild the CLI (`pnpm nx run cli:build` or equivalent) — hooks execute
  `apps/cli/dist`, and a stale dist silently runs old code.

## Tasks
1. Read `packages/core/src/ansible.ts` and any `ansible.cfg` to determine how
   config/env reaches `ansible-playbook`; wire up `profile_tasks` (+ `timer`)
   the way the codebase already passes config.
2. Verify locally that a `--dry-run`-safe invocation (e.g. `ansible-playbook
   --syntax-check` or a check-mode run) shows the callback is active.
3. If CLI source changed, rebuild the CLI dist and verify the build output is
   what the hook will execute.
4. Commit the instrumentation to emit-infra.
5. Run the floor measurement: develemail `sprint/*.md`-only commit +
   `EMIT_FORCE_DEPLOY=1 git push`. Confirm per-task durations appear in
   develemail's `.deploy-logs/<sha>.log`.
6. Run one normal code-touching deploy (or reuse sprint 252's if timing is
   already captured) for a with-build data point.
7. Write `docs/DEPLOY-FLOOR.md`: table of the top ~10 tasks by duration for the
   retag-only run, the phase totals from `.deploy-history.jsonl`, and a ranked
   hypothesis list for sprint 254 (explicitly note anything that points at the
   blue-green script's internals rather than Ansible tasks).

## Files involved
- `packages/core/src/ansible.ts` — likely where the callback env/config gets
  injected
- `ansible.cfg` (new file at repo root, or edit if present) — alternative
  injection point
- `ansible/playbooks/deploy.yml`, `ansible/roles/app-deploy/tasks/*.yml` —
  read-only reference this sprint (no task changes)
- `ansible/roles/app-deploy/files/` or `templates/` (blue-green script) —
  optional coarse timestamps only
- new file: `docs/DEPLOY-FLOOR.md` — findings
- `~/projects/develemail` — measurement target

## Acceptance criteria
- [ ] Per-task durations appear in `.deploy-logs/<sha>.log` for a real deploy
      without any manual flags — instrumentation is always-on
- [ ] A retag-only (floor) deploy and a with-build deploy are both captured
- [ ] `docs/DEPLOY-FLOOR.md` ranks tasks by cost and names the top 3
      contributors to the ~200s floor, with numbers
- [ ] Deploy behavior is unchanged — instrumentation only; the measured deploys
      succeed and `.deploy-status.json` ends `deployed`
- [ ] Test coverage: if `ansible.ts` changes, `packages/core/src/ansible.test.ts`
      gains/updates a test asserting the callback config is passed; existing
      core tests stay green
- [ ] emit-infra typecheck/lint/test green

## Out of scope
- Fixing anything found — that's sprint 254. Resist the urge; the one exception
  is a trivially safe config line (e.g. enabling SSH pipelining) **only if**
  needed to make measurement itself reliable, and it must be called out in the
  findings doc
- The 1500s outlier's root cause (note any evidence found, don't chase it)
- Dashboard display of timings (sprint 256)
