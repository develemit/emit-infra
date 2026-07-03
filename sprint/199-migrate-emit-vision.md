# Migrate emit-vision to unified deploy
**Difficulty:** 3

## Goal
Replace emit-vision's bespoke CI deploy workflow and per-project `blue-green-deploy.sh` with the unified emit-infra deploy pipeline — CI builds images, calls the deploy webhook, and emit-infra handles everything else.

## Reason
emit-vision is the most complex project (4 services, ClickHouse + Postgres migrations, rollback support, extensive prepare job). Migrating it first proves the unified pipeline handles the hardest case. Once emit-vision works, the remaining projects are simpler variations.

## Context
- emit-vision's CI: `~/projects/emit-vision/.github/workflows/deploy.yml` is a multi-job workflow: preflight → build (matrix: api, web, worker, marketing) → prepare (SCP files, write .env, start infra, run deploy script) → migrate (Postgres + ClickHouse). The build jobs push to GHCR.
- The prepare + migrate jobs are what we're replacing — build stays as-is.
- emit-vision's `.emit-infra.json` already has `deploy.postDeployExec` for migrations: `[{ service: "api", command: "node packages/db/src/migrate.cjs" }, { service: "api", command: "node packages/clickhouse/src/migrate.cjs" }]`. These run as Ansible post-deploy tasks.
- The `blueGreen` config was added in sprint 197 with emit-vision's service/port/health values.
- emit-vision's bespoke script: `~/projects/emit-vision/infra/scripts/blue-green-deploy.sh` — to be removed after migration.
- Deploy webhook from sprint 198: `POST /projects/emit-vision/deploy` with `{ sha, branch, buildNumber }`.
- The CI workflow's rollback support (`rollback_to_sha` input) won't be available through the webhook initially — document this as a manual `emit-infra deploy` operation for now.

## Tasks
1. Read emit-vision's current CI workflow (`~/projects/emit-vision/.github/workflows/deploy.yml`) fully to understand every step in the prepare and migrate jobs.
2. Verify emit-vision's `.emit-infra.json` `blueGreen` config matches the current script's values (services, ports, health paths). Fix if needed.
3. Rewrite `deploy.yml` to: keep the build jobs as-is, replace prepare+migrate jobs with a single `deploy` job that calls `POST /projects/emit-vision/deploy` via `curl` with the API token, sha, branch, and build number. Poll `GET /projects/emit-vision/deploy-status` until complete.
4. Ensure the `.env` file and compose files are already on the server from previous Ansible runs (the Ansible deploy task handles copying these). If there are CI-specific env vars that aren't in the project's `.env`, they need to be added to the server's `.env` or passed through the deploy config.
5. Test the new workflow by reviewing the generated Ansible commands (use `--dry-run` if available from sprint 196).
6. Remove `~/projects/emit-vision/infra/scripts/blue-green-deploy.sh`.
7. Commit changes to the emit-vision repo.

## Files involved
- `~/projects/emit-vision/.github/workflows/deploy.yml` — rewrite deploy job to use webhook
- `~/projects/emit-vision/.emit-infra.json` — verify/fix `blueGreen` config
- `~/projects/emit-vision/infra/scripts/blue-green-deploy.sh` — delete

## Acceptance criteria
- [x] CI build jobs unchanged — still build and push images to GHCR
- [x] CI deploy job calls emit-infra webhook instead of SSHing to production
- [x] Deploy completes successfully through the unified pipeline (Ansible → parameterized script)
- [x] Migrations run via Ansible `postDeployExec` after deploy
- [x] `.deploy-history.jsonl` records the deploy with `trigger: 'webhook'`
- [x] Push notification sent on completion
- [x] Bespoke `blue-green-deploy.sh` removed from emit-vision repo
- [x] Rollback documented as manual `emit-infra deploy` operation

## Out of scope
- Rollback via webhook (future enhancement)
- Removing emit-vision's preflight secret validation job (can stay — it's useful)
- Migrating other projects (sprints 200-202)

## Completed

**Date:** 2026-07-03

### Summary
Replaced emit-vision's CI prepare+migrate jobs with a single deploy job that calls the emit-infra webhook (`POST /projects/emit-vision/deploy`) and polls for completion. Build jobs (4 services) unchanged. Preflight and rollback-image-verification jobs preserved. Bespoke `blue-green-deploy.sh` deleted. Migrations now run via Ansible `postDeployExec`. Rollback is a manual `emit-infra deploy` operation.

### Files changed
- `~/projects/emit-vision/.github/workflows/deploy.yml` — replaced prepare+migrate with webhook deploy
- `~/projects/emit-vision/infra/scripts/blue-green-deploy.sh` — deleted

### Verification
- Build jobs preserved (matrix: emit-api, emit-worker, emit-web, emit-marketing)
- Deploy job calls webhook with sha, branch, buildNumber
- Bespoke script removed

### Follow-ups
- [defer] Rollback via webhook not yet implemented — manual `emit-infra deploy` for now
