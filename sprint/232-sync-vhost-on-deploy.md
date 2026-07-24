# Sync nginx vhost on deploy with validation and rollback (opt-in)
**Difficulty:** 4

## Goal
When a project sets `nginx.syncOnDeploy: true`, every deploy copies its repo-owned vhost to the server, runs `nginx -t` **before** reloading, and fails the deploy without reloading if validation fails — restoring the previous config. Projects that don't set the flag behave exactly as they do today.

## Reason
This is the core fix for the incident described in sprints 230/231: `ansible/playbooks/deploy.yml` runs only `app-deploy` and `postgres-backup`, so the `nginx` role — the only thing that ever writes a vhost — runs at provision time and never again. A vhost committed to an app repo is documentation, not configuration. emit-vision has a correct `/v1` routing fix sitting in its repo (commit `f852d4b`) that physically cannot reach production through the normal deploy path.

**This sprint ships inert on purpose.** Five projects declare `nginx.customConfigSrc` (emit-vision, develemail, emit-social, tastease, martialops) and their on-server files have drifted by an unknown amount after being hand-edited at bootstrap. Flipping sync on for all of them at once would silently overwrite months of undocumented server-side fixes and could take down four working projects while fixing one. So the mechanism lands behind a per-project flag defaulting to `false`, and projects get opted in one at a time (sprint 235 does emit-vision) after reviewing their drift in the panel from sprint 231.

## Context
**Where the hook goes.** `apps/cli/src/commands/deploy.ts:99` exports a pure function `buildDeployExtraVars(config, cwd, env, existsFn)` that builds the Ansible `--extra-vars` payload. It currently sets `compose_src`, `extra_files`, `env_src`, `app_port` etc. but **never `nginx_custom_config_src`** — that var is only ever passed by `setup.ts:242` (provision) and `configure.ts:36`. Adding it here is the whole CLI-side fix.

Critically, `apps/api/src/routes/deploy.ts:63` runs `execa('npx', ['emit-infra', 'deploy', name])` — the HTTP API that app repos call goes through the same CLI function. One change covers both paths.

⚠️ **The CLI must be rebuilt.** This repo runs `apps/cli/dist`, not the TypeScript source. A source change that isn't rebuilt means deploys silently keep running the old code — this has bitten this project before. Rebuild the CLI as an explicit task and verify the built output contains the new var.

**Why not Ansible's `validate:` parameter.** `copy:`/`template:` support a `validate:` arg, but it runs the validator against a **temp path**, and `nginx -t` validates the entire server config graph from the real location — an include-based vhost referencing `/etc/nginx/blue-green/<project>.conf` won't validate correctly from a temp file. Use the explicit backup → write → test → reload-or-restore sequence instead.

**Proven pattern to copy.** `ansible/roles/app-deploy/files/blue-green-deploy.sh:232-250` already does exactly this for the upstream include file: `cp` to `.bak`, write, `nginx -t`, on failure restore the `.bak` and `exit 1`, on success `nginx -s reload` and remove the `.bak`. Mirror that shape in Ansible tasks.

**Ordering.** Run the vhost sync **after** the deploy strategy completes (`app-deploy/tasks/main.yml:98-108`), so the blue-green upstream include file is already current. A vhost referencing an upstream name that the include doesn't define yet would fail `nginx -t` — note this in the failure message so the cause is obvious.

**Reload, not restart** — zero-downtime is a hard requirement. `service: name=nginx state=reloaded` or `nginx -s reload`.

Relevant files:
- `packages/types/src/project-config.ts:42-47` — the `nginx` config object (`wildcardCert`, `customConfigSrc`)
- `ansible/roles/nginx/tasks/main.yml:22-30` — the provision-time copy; destination is `/etc/nginx/sites-available/{{ project_name }}`
- `ansible/roles/app-deploy/tasks/main.yml` (140 lines) — where the new include goes
- `apps/cli/src/commands/deploy.test.ts` — existing tests for `buildDeployExtraVars`

## Tasks
1. Add `syncOnDeploy: z.boolean().default(false)` to the `nginx` object in `packages/types/src/project-config.ts`.
2. In `buildDeployExtraVars` (`apps/cli/src/commands/deploy.ts`), when `config.nginx?.syncOnDeploy` is true **and** `config.nginx.customConfigSrc` is set, add `extraVars.nginx_custom_config_src = join(cwd, config.nginx.customConfigSrc)`. Leave it unset otherwise.
3. Surface the vhost path in the existing `--dry-run` output block (see the `compose_src` / `env_src` reporting around `deploy.ts:49-70`), including the `✓`/`✗ missing` existence check the other paths get.
4. Create `ansible/roles/app-deploy/tasks/sync-vhost.yml` that, guarded by `when: nginx_custom_config_src is defined`:
   - Stats `/etc/nginx/sites-available/{{ project_name }}`
   - Backs it up to `.bak` when it exists
   - Copies the new vhost into place, registering the result so `changed` is known
   - Runs `command: nginx -t` with `ignore_errors: true`, registered
   - On validation failure: restores the `.bak`, then `fail:` with a message naming the project, the vhost path, and the `nginx -t` stderr — and explicitly mentioning that an undefined upstream name is a likely cause
   - On success: reloads nginx (only when the copy actually changed) and removes the `.bak`
   - Emits a `debug:` line stating whether the vhost was updated or already current, so the deploy log shows it either way
5. Include `sync-vhost.yml` from `ansible/roles/app-deploy/tasks/main.yml` after the deploy-strategy includes.
6. Extend `apps/cli/src/commands/deploy.test.ts`: var absent when `syncOnDeploy` is false or unset; var absent when `syncOnDeploy` is true but `customConfigSrc` is missing; var present and correctly joined to `cwd` when both are set.
7. Rebuild the CLI (`npx nx run cli:build`) and confirm `nginx_custom_config_src` appears in `apps/cli/dist`.
8. Run `npx nx run cli:test`, `npx nx run cli:typecheck`, and `npx nx run types:typecheck`.

## Files involved
- `packages/types/src/project-config.ts` — add the `syncOnDeploy` flag
- `apps/cli/src/commands/deploy.ts` — pass `nginx_custom_config_src` when opted in; dry-run reporting
- `apps/cli/src/commands/deploy.test.ts` — cover the opt-in matrix
- (new file) `ansible/roles/app-deploy/tasks/sync-vhost.yml` — backup/write/validate/reload-or-restore
- `ansible/roles/app-deploy/tasks/main.yml` — include the new task file
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — read-only reference for the validate/rollback pattern; do not modify

## Acceptance criteria
- [x] A project **without** `nginx.syncOnDeploy` produces an identical `extraVars` payload to before this sprint — no behavior change.
- [x] A project with `syncOnDeploy: true` and `customConfigSrc` set passes `nginx_custom_config_src` as an absolute path.
- [x] Invalid nginx config fails the deploy **before** any reload, and the previous vhost is restored.
- [x] A successful sync reloads (never restarts) nginx, and only when the file actually changed.
- [x] The deploy log states whether the vhost was updated or already current.
- [x] `apps/cli/dist` is rebuilt and contains the new variable.
- [x] `npx nx run cli:test` passes; `cli:typecheck` and `types:typecheck` are clean.

## Out of scope
- **Turning the flag on for any project** — every project stays on the current behavior after this sprint. Sprint 235 opts in emit-vision.
- The `apiPathPrefix` template feature — that's sprint 233.
- Drift detection and UI — shipped in sprints 230/231.
- Reconciling projects that use the generated `upstream-site.conf.j2` template instead of `customConfigSrc`.
- Pruning extra server-side vhosts that no project declares.

## Completed

**Date:** 2026-07-23

### Summary
Added an opt-in `nginx.syncOnDeploy` flag that makes the deploy path push a project's repo-owned vhost to the server on every deploy, with `nginx -t` validation and automatic rollback before any reload. The flag defaults to `false`, so every project's deploy behavior is byte-for-byte unchanged unless it explicitly opts in (sprint 235 opts in emit-vision).

`buildDeployExtraVars` in `apps/cli/src/commands/deploy.ts` now sets `nginx_custom_config_src` (joined to `cwd`) only when both `config.nginx.syncOnDeploy` and `config.nginx.customConfigSrc` are truthy. Since `apps/api/src/routes/deploy.ts` shells out to the same CLI `deploy` command, the API-triggered deploy path picks up the fix for free — no separate change needed there. The `--dry-run` output now reports the vhost path with the same `✓`/`✗ missing` existence check the other deploy artifacts get.

On the Ansible side, `ansible/roles/app-deploy/tasks/sync-vhost.yml` mirrors the backup → write → `nginx -t` → reload-or-restore sequence already proven in `blue-green-deploy.sh:232-250`. It's included from `app-deploy/tasks/main.yml` after the deploy-strategy includes (blue-green/zero-downtime/standard) so a blue-green vhost referencing the upstream include file only validates once that include is current — the failure message calls this out explicitly if `nginx -t` fails. The whole include is gated with a single `when: nginx_custom_config_src is defined` on the `include_tasks` call in `main.yml`, so individual tasks inside `sync-vhost.yml` don't need to repeat the guard. Reload uses `service: name=nginx state=reloaded` (never `restarted`) and only fires when the copy task actually reports `changed`; a `debug:` task always reports whether the vhost was updated or already current, satisfying the "state either way" log requirement.

### Files changed
- `packages/types/src/project-config.ts` — added `syncOnDeploy: z.boolean().default(false)` to the `nginx` config object
- `apps/cli/src/commands/deploy.ts` — `buildDeployExtraVars` sets `nginx_custom_config_src` when opted in; dry-run output reports the vhost path
- `apps/cli/src/commands/deploy.test.ts` — added the opt-in matrix (unset / false / true-without-src / true-with-src)
- (new) `ansible/roles/app-deploy/tasks/sync-vhost.yml` — backup/write/validate/reload-or-restore for the vhost
- `ansible/roles/app-deploy/tasks/main.yml` — includes `sync-vhost.yml` after the deploy-strategy block, guarded on `nginx_custom_config_src is defined`

### Verification
- `npx nx run cli:test`: 70/70 pass (16 in `deploy.test.ts`, including 4 new)
- `npx nx run cli:typecheck`: clean
- `npx nx run types:typecheck`: clean
- `npx nx run cli:build` then `grep nginx_custom_config_src apps/cli/dist/*.js`: 6 matches — confirms the rebuilt bundle contains the new var
- `python3 -c "yaml.safe_load(...)"` on both changed/new Ansible YAML files: parses clean
- `ansible-playbook --syntax-check ansible/playbooks/deploy.yml`: passes (only expected "no inventory" warnings)

### Follow-ups
- `[defer]` No live end-to-end test of the actual backup/validate/rollback sequence against a real nginx install — verified by YAML syntax check and code review against the proven `blue-green-deploy.sh` pattern only. Worth a manual dry run against a staging box before flipping `syncOnDeploy: true` for any project (sprint 235).
- `[defer]` `ansible-lint` isn't installed in this environment; only `ansible-playbook --syntax-check` and a raw YAML parse were run.
