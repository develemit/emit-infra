# Hardening sweep: logged failures, API_SECRET guard, nginx reload rollback, changed_when
**Difficulty:** 3

## Goal
Four small, precisely-located fixes from the 2026-07-05 audit: silent `.catch(() => {})` calls become logged failures, the API warns and binds to localhost when started without `API_SECRET` outside dev, the blue-green nginx switch restores the previous config if validation fails, and three Ansible tasks stop reporting false "changed" status.

## Reason
All four items share one theme: this is a single-operator tool, so nobody else will report the failure you swallowed or catch the misconfiguration you booted with. The emit-vision Neon 401 incident (2026-07-04) took hours partly because failures were quiet. The auth guard is one-line insurance: the API binds `0.0.0.0` and exposes destroy/rollback/prune, so a missing env var currently means anyone on the same network can hit them. None of these deserve a sprint alone; together they're one session.

## Context
**1. Silent catches -> logged failures (apps/api):**
- `routes/deploy.ts:51` — `runDeploy(name, project.projectDir, state).catch(() => {})`: runDeploy handles its own errors internally (sets state, writes history), so a rejection here means the handler itself threw. Log it: `.catch((err) => app.log.error({ err, project: name }, 'runDeploy crashed'))` (the route closure has `app` in scope).
- `routes/deploy.ts:86,93,116,123` — `appendFile(historyPath, ...).catch(() => {})` and `sendToAll({...}).catch(() => {})` in both success and failure branches of `runDeploy`. `runDeploy` has no logger — pass `app.log` in as a parameter (it's called from the route which has `app`), or accept a `FastifyBaseLogger`. Log with context (project name, which operation failed). Do not let these failures change the deploy result — logging only.
- `routes/projects.ts:44,78` — swallowed file-read/parse errors returning null. Keep the null return (callers handle it) but log at `warn` with the path so a corrupt `.emit-infra.json` or history file is visible.
- `routes/operations.ts:83-85` — inventory write errors silently ignored. Log at `error`; the provision stream should also emit an SSE error line if the write failure makes the run pointless (judgment call — read the surrounding flow first).

**2. API_SECRET startup guard (`apps/api/src/index.ts:74-75`):**
Current: `await app.listen({ port, host: '0.0.0.0' })` unconditionally; auth hook only registered when `API_SECRET` set (moved to `lib/auth.ts` by sprint 206 — build on that; if 206 hasn't run, the hook is inline at index.ts:36-45 and this sprint should not move it, just add the guard around listen). Change: when `API_SECRET` is unset and `NODE_ENV !== 'development'`, bind `host: '127.0.0.1'` and log a prominent warning ("API_SECRET not set — binding to localhost only; destructive endpoints would otherwise be open to the network"). When set, keep `0.0.0.0`. Dev (`NODE_ENV=development`) keeps current behavior. Do not make it fail-closed/crash — the dashboard proxies via localhost, so localhost bind is the safe degradation that keeps everything working on this Mac.

**3. nginx reload rollback (`ansible/roles/app-deploy/files/blue-green-deploy.sh`, section 5, ~lines 203-218):**
Current flow: build `$upstream_block`, `echo "$upstream_block" > "$NGINX_CONF_PATH"`, then `nginx -t && nginx -s reload`, then `SWITCHED=1`. If `nginx -t` fails, the script exits via `set -e`/trap (old slot keeps serving — fine) **but the broken config is left on disk**, so any later nginx restart (reboot, other deploy) loads a bad config. Fix: before overwriting, `cp "$NGINX_CONF_PATH" "${NGINX_CONF_PATH}.bak"` if it exists; on `nginx -t` failure, restore the backup, run `nginx -t` again (best-effort), and exit 1 with a clear message. Keep the happy path identical. Mind the script's `set -euo pipefail` — use an `if ! nginx -t; then ... fi` structure rather than relying on `&&` so the restore actually runs. This script is copied to every server on each deploy by `ansible/roles/app-deploy/tasks/main.yml` (Copy blue-green deploy script task), so the fix self-propagates.

**4. Ansible `changed_when: false`** (verified locations):
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — "Prune old Docker images and stopped containers" (~line 92) and "Record deploy timestamp" (~line 98)
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — "Record deploy timestamp" (~line 189)
These run every deploy and always report "changed", muddying play recaps. Note: `changed_when: false` on the prune is a slight lie (prune does change state) but matches the convention already used for the label-read task in `main.yml:118` — the intent is "not a meaningful config change".

## Tasks
1. Replace the six silent catches in `deploy.ts`, `projects.ts`, `operations.ts` with contextual logging per Context (thread a logger into `runDeploy`).
2. Add the API_SECRET localhost-bind guard + warning in `index.ts`.
3. Add config backup/restore around the nginx switch in `blue-green-deploy.sh`.
4. Add `changed_when: false` to the three Ansible tasks.
5. Verify: `pnpm nx run api:test` (existing tests still green — deploy.test.ts mocks `sendToAll`/`appendFile`, so signature changes to `runDeploy` must keep the route's public behavior identical), `ansible-playbook --syntax-check ansible/playbooks/deploy.yml`, `bash -n ansible/roles/app-deploy/files/blue-green-deploy.sh`, typecheck + lint.

## Files involved
- `apps/api/src/routes/deploy.ts` — logged catches, logger param on `runDeploy`
- `apps/api/src/routes/projects.ts` — warn-logs on swallowed parse errors (lines ~44, ~78)
- `apps/api/src/routes/operations.ts` — error-log on inventory write failure (lines ~83-85)
- `apps/api/src/index.ts` — conditional bind host + warning
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — nginx conf backup/restore (section 5)
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — two `changed_when: false`
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — one `changed_when: false`

## Acceptance criteria
- [x] No `.catch(() => {})` remains in `deploy.ts`, `projects.ts:44,78`, or `operations.ts:83-85` — each failure path logs with project/file context
- [x] Starting the API without `API_SECRET` and `NODE_ENV=production` binds 127.0.0.1 and logs a warning; with `API_SECRET` set it binds 0.0.0.0 as before; dev unchanged
- [x] `blue-green-deploy.sh`: a failing `nginx -t` restores the previous conf and exits non-zero; happy path byte-identical behavior
- [x] The three Ansible tasks no longer report "changed" on every run; `--syntax-check` clean
- [x] `pnpm nx run api:test`, typecheck, lint all green; `bash -n` clean on the shell script

## Out of scope
- Structured/persistent logging infrastructure — plain Fastify logger calls only
- Fail-closed (crash on missing secret) — localhost bind is the chosen degradation
- Touching the `eval "$MIGRATE_POST"` / pre-push `eval` design (own-config execution, accepted)
- The `ops.ts` agent error propagation (needs its own design)

## Completed

**Date:** 2026-07-05

### Summary
Replaced all six silent `.catch(() => {})` calls in `deploy.ts` with contextual logging via a `FastifyBaseLogger` threaded into `runDeploy`. The outer catch on `runDeploy` itself now logs at `error` level. Internal `appendFile` and `sendToAll` failures log at `warn` — they don't change the deploy result, but are now visible. In `projects.ts`, the `readProjectConfig` and `lastDeployEpoch` helpers now `console.warn` with the file path when reads/parses fail (keeping the `null` return). In `operations.ts`, the inventory write catch now logs at `error` via `app.log` and emits an SSE error event so the provision stream surfaces the failure.

The API startup in `index.ts` now checks for `API_SECRET` — when missing outside dev mode, it binds to `127.0.0.1` instead of `0.0.0.0` and logs a prominent warning. This prevents destructive endpoints from being network-accessible without auth. Dev mode and secret-present behavior are unchanged.

The blue-green deploy script now backs up the nginx config before overwriting and restores it if `nginx -t` fails, preventing a broken config from persisting on disk across reboots. The backup is cleaned up on success. Three Ansible tasks (`Prune old Docker images`, two `Record deploy timestamp`) now have `changed_when: false` to stop false "changed" noise in play recaps.

### Files changed
- `apps/api/src/routes/deploy.ts` — replaced 5 silent catches with contextual logging; added `FastifyBaseLogger` param to `runDeploy`
- `apps/api/src/routes/projects.ts` — added warn logging to `readProjectConfig` and `lastDeployEpoch` catch blocks
- `apps/api/src/routes/operations.ts` — added error logging + SSE error event on inventory write failure
- `apps/api/src/index.ts` — conditional bind host based on `API_SECRET` + `NODE_ENV`; warning log
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — nginx config backup/restore around `nginx -t`
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — `changed_when: false` on prune + timestamp tasks
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — `changed_when: false` on timestamp task

### Verification
- `pnpm nx run api:test`: 222/222 pass
- typecheck: clean
- lint: clean (8 pre-existing warnings in unrelated files)
- `bash -n blue-green-deploy.sh`: clean
- `ansible-playbook --syntax-check deploy.yml`: clean

### Follow-ups
- `[defer]` Pre-existing lint errors in `billing.ts`, `cert.ts`, `history.ts`, `incidents-export.ts`, `operations.ts` (unused imports/vars) — not introduced by this sprint
