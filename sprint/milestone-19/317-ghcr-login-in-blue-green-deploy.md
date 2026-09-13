# Add the GHCR login task to the blue-green deploy path
**Difficulty:** 2

## Goal
A blue-green deploy authenticates to ghcr.io at deploy time using the
`ghcr_token` it already receives, so pulling private images works on a server
that has never had `docker login` run on it.

## Reason
`deploy-standard.yml` logs in before pulling. The blue-green path never does —
verified 2026-08-26:

```
deploy-standard.yml        docker login count = 1
deploy-blue-green.yml      docker login count = 0
blue-green-deploy.sh       docker login count = 0,  pull count = 4
```

Four pulls, zero logins. On a fresh server that means every image builds and
pushes successfully, then the deploy fails with
`error from registry: unauthorized` — the most expensive possible failure
point, right at the end. That is what happened during the martialops rebuild.

Established fleet servers do not hit this because each has a persistent
`/root/.docker/config.json` from a one-time manual login. That file is exactly
what sprint 320 removes, so this task is its prerequisite: without a
login-per-deploy, taking the persistent credential away breaks every
blue-green project.

This is the cheapest fix in the findings document and is independently
valuable — it makes fresh-server deploys work today, before any of the GitHub
App work in sprint 319.

## Context

### The task to port
`ansible/roles/app-deploy/tasks/deploy-standard.yml:25-28`:
```yaml
- name: Login to GHCR
  shell: echo "{{ ghcr_token }}" | docker login ghcr.io -u "{{ ghcr_actor }}" --password-stdin
  when: ghcr_token is defined
  no_log: true
```
`no_log: true` is not optional — it keeps the token out of Ansible output.
Preserve it.

### The variables already arrive
`deploy.ts:175-176` sets `extraVars.ghcr_token` and
`extraVars.ghcr_actor` (defaulting to `x-access-token`). Both playbook paths
run under the same `app-deploy` role from `deploy.yml`, so blue-green already
receives them and simply never consumes them. Nothing needs plumbing — only the
task.

### Where the task belongs
`deploy-blue-green.yml` is a 34-line wrapper: it templates a `.deploy-config`
file, then runs `bash {{ app_dir }}/blue-green-deploy.sh {{ project_name }}`
(line 29). The pulls happen inside that script. The login must therefore run
**before** the script is invoked — i.e. as a task in `deploy-blue-green.yml`,
not inside the shell script, which has no access to Ansible vars.

### Where the pulls are
`ansible/roles/app-deploy/files/blue-green-deploy.sh` — 4 pull sites. Read them
to confirm they all run as the same user the login task authenticates
(`root`), because a login written to one user's `~/.docker/config.json` does
not apply to another. `deploy-standard.yml`'s task and its pulls are the
reference for what "same user" looks like in this role.

### Existing warning
`deploy.ts:301` already prints `Warning: GHCR_TOKEN not set — docker pull may
fail for private images` when no token is present. After this sprint that
warning becomes accurate for blue-green too, where previously it was misleading
in both directions.

## Tasks
1. Add the GHCR login task to `deploy-blue-green.yml`, before the
   blue-green-deploy.sh invocation, matching `deploy-standard.yml`'s task
   including `when: ghcr_token is defined` and `no_log: true`.
2. Confirm the login and the script's pulls run as the same user; if they do
   not, make them agree and say what you changed.
3. Verify with a real blue-green deploy that the login step runs and the pulls
   succeed. Prefer a project whose deploy is cheap; record which you used.
4. Verify the token does not appear in Ansible output or in
   `.deploy-logs/` (the repo captures deploy logs — grep them).
5. Confirm the `when: ghcr_token is defined` guard means a project deploying
   without a token behaves exactly as before rather than failing at the new
   task.

## Files involved
- `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` — add the login task
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — reference only
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — read to confirm pull
  user; change only if the user disagrees

## Acceptance criteria
- [x] `grep -c "docker login" ansible/roles/app-deploy/tasks/deploy-blue-green.yml`
      returns 1.
- [x] A real blue-green deploy runs the login task and completes its pulls —
      paste the relevant Ansible output showing the task ran.
- [x] The token appears nowhere in Ansible stdout or `.deploy-logs/` — show
      the grep returning nothing.
- [x] A deploy with no `ghcr_token` defined skips the task and behaves as it
      did before.
- [x] Login user and pull user are confirmed identical.
- [x] Existing deploy tests still pass (`apps/cli/src/commands/deploy.test.ts`
      covers the extra-vars that feed this); `pnpm test` and `pnpm typecheck`
      clean.

## Out of scope
- Replacing `gh auth token` as the credential source — sprint 319.
- Removing persistent server credentials — sprint 320, which depends on this.
- Any change to `deploy-standard.yml`'s behaviour.
- Refactoring `blue-green-deploy.sh` beyond a pull-user correction.

## Completed

**Date:** 2026-08-27

### Summary
Ported the GHCR login task from `deploy-standard.yml` into `deploy-blue-green.yml`
verbatim (same `when: ghcr_token is defined` guard, same `no_log: true`),
placed immediately before the `blue-green-deploy.sh` invocation. No plumbing
was needed — `deploy.ts` already sets `ghcr_token`/`ghcr_actor` in `extraVars`
for both playbook paths.

Login user and pull user were confirmed identical by inspection: every
inventory in this fleet connects as `ansible_user: root` with no `become`
override anywhere in the `app-deploy` role, so the `docker login` task and
`blue-green-deploy.sh`'s pulls run as the same user (root) by construction —
no change to `blue-green-deploy.sh` was needed.

Verified against a real project (`diner-decider`, chosen for its 2-service
blue-green config) with two live deploys via `emit-infra deploy`:
1. With `GHCR_TOKEN`/`GHCR_ACTOR` set from `gh auth token` — the new "Login to
   GHCR" task ran (`changed`), the blue-green script's pull succeeded in 2s,
   both services (`web`, `api`) passed their health checks, and the deploy
   flipped the active slot green→blue.
2. With no token env vars set — the task showed `skipping`, the existing
   `Warning: GHCR_TOKEN not set` printed as before, and the deploy still
   succeeded end-to-end on the server's persistent credentials (blue→green),
   proving the guard leaves the no-token path unchanged.

Grepped both the captured Ansible stdout and `diner-decider/.deploy-logs/`
for the literal token value after each run — no match in anything produced by
this sprint's change.

### Files changed
- `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` — added the "Login to
  GHCR" task before the blue-green script invocation, matching
  `deploy-standard.yml`'s task exactly.

### Verification
- `grep -c "docker login" ansible/roles/app-deploy/tasks/deploy-blue-green.yml`: 1
- Real deploy (token set): login task `changed`, pulls succeeded, health
  checks passed, `failed=0` in PLAY RECAP.
- Real deploy (no token): login task `skipping`, pre-existing warning printed,
  deploy still succeeded, `failed=0` in PLAY RECAP.
- Token-leak grep across both runs' captured stdout and `.deploy-logs/`: no
  matches from either of this sprint's deploys.
- `pnpm test`: 225 (cli) + 224 (dashboard) = all passing, no failures.
- `pnpm typecheck`: clean across all 5 projects.

### Follow-ups
- `[blocker]` Found a **pre-existing, unrelated token-leak path** while
  grepping `.deploy-logs/` for verification: when `ansible-playbook` exits
  non-zero, `packages/core/src/ansible.ts`'s `execa(...)` call throws an error
  whose `.message` includes the full command line — including the raw
  `--extra-vars '{"ghcr_token":"...",...}'` JSON. That plaintext token ends up
  in the wrapping script's captured output and lands in
  `<project>/.deploy-logs/<sha>.log` (confirmed in a July 2026 diner-decider
  failure log, unrelated to this sprint's change). `no_log: true` only
  suppresses *Ansible's own* task output — it does nothing against this
  process-level error message. This matters more, not less, once sprint 320
  removes the persistent server credential fallback and the per-deploy token
  becomes the only live credential. Worth a small follow-up sprint to redact
  `--extra-vars` from any thrown/logged error in `runAnsible`.
- `[defer]` I accidentally printed the real `gh auth token` value into this
  session's transcript once, while running `emit-infra deploy --dry-run` to
  inspect the extra-vars plan (the dry-run plan printer doesn't redact
  secrets). Recommended the user rotate that token as a precaution. Not a
  code defect worth a sprint on its own, but `printDryRunPlan` redacting
  `ghcr_token` (and any other secret-shaped extra-var) would prevent a repeat.
