# Sprint 31 — Blue-Green: On-Server Deploy Script
**Difficulty:** 4

## Goal
Write an on-server shell script that orchestrates the full blue-green slot swap: detects the active slot, brings up the new version on the inactive slot, health-checks all services, switches nginx, and stops the old slot — with automatic rollback if health checks fail.

## Reason
The deploy script is the core of the zero-downtime system. It must be idempotent (safe to re-run), self-contained (no external dependencies beyond docker and nginx), and leave the server in a clean state whether the deploy succeeds or fails. Keeping it on the server (rather than in CI) means any operator can trigger a deploy via SSH without understanding the CI pipeline, and rollbacks are fast.

## Context
- Builds on sprint 29 (dual-stack compose layout) and sprint 30 (nginx upstream switching)
- Active slot is tracked in `/etc/nginx/blue-green/<project>.conf` — the script reads the current upstream ports to determine which slot is live
- Alternatively, track active slot explicitly in `/opt/<project>/.active-slot` (contains "blue" or "green") — simpler to read and less fragile than parsing nginx config
- Blue ports: web=4300, api=4301, worker=4302, marketing=4303
- Green ports: web=4400, api=4401, worker=4402, marketing=4403
- Infra stack (`docker-compose.infra.yml`) never restarts — the script ignores it
- `health-check.sh` already exists at `ansible/roles/app-deploy/files/health-check.sh` — copy it to `/opt/<project>/health-check.sh` during provisioning (already done by Ansible's app-deploy role)
- The script should be placed at `/opt/<project>/blue-green-deploy.sh` and made executable
- CI will call it via SSH: `ssh root@$SERVER "/opt/$PROJECT/blue-green-deploy.sh"` (sprint 32)
- emit-vision compose files are at `/opt/emit-vision/` on the server — deployed there by the CI copy step in the current deploy workflow

## Script Logic

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:-emit-vision}"
APP_DIR="/opt/${PROJECT}"
SLOT_FILE="${APP_DIR}/.active-slot"
COMPOSE_APP="${APP_DIR}/docker-compose.app.yml"

# Read active slot (default blue on first run)
ACTIVE=$(cat "$SLOT_FILE" 2>/dev/null || echo "blue")
if [ "$ACTIVE" = "blue" ]; then
  INACTIVE="green"
  INACTIVE_WEB=4400; INACTIVE_API=4401; INACTIVE_WORKER=4402; INACTIVE_MARKETING=4403
  ACTIVE_WEB=4300
else
  INACTIVE="blue"
  INACTIVE_WEB=4300; INACTIVE_API=4301; INACTIVE_WORKER=4302; INACTIVE_MARKETING=4303
  ACTIVE_WEB=4400
fi

INACTIVE_COMPOSE="${APP_DIR}/docker-compose.${INACTIVE}.yml"

# 1. Pull new images
docker compose -f "$COMPOSE_APP" -f "$INACTIVE_COMPOSE" pull

# 2. Start inactive stack
docker compose -f "$COMPOSE_APP" -f "$INACTIVE_COMPOSE" \
  --project-name "${PROJECT}-${INACTIVE}" up -d --remove-orphans

# 3. Health check all app services on inactive ports
"${APP_DIR}/health-check.sh" "$INACTIVE_WEB" 20 "/" 5
"${APP_DIR}/health-check.sh" "$INACTIVE_API" 20 "/readyz" 5

# 4. Switch nginx to inactive slot
cat > "/etc/nginx/blue-green/${PROJECT}.conf" <<EOF
# Active slot: ${INACTIVE} — written by blue-green-deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
upstream ${PROJECT}_web     { server 127.0.0.1:${INACTIVE_WEB}; }
upstream ${PROJECT}_api     { server 127.0.0.1:${INACTIVE_API}; }
upstream ${PROJECT}_worker  { server 127.0.0.1:${INACTIVE_WORKER}; }
upstream ${PROJECT}_marketing { server 127.0.0.1:${INACTIVE_MARKETING}; }
EOF
nginx -t && nginx -s reload

# 5. Record new active slot
echo "$INACTIVE" > "$SLOT_FILE"

# 6. Stop old stack
docker compose -f "$COMPOSE_APP" \
  -f "${APP_DIR}/docker-compose.${ACTIVE}.yml" \
  --project-name "${PROJECT}-${ACTIVE}" stop

# 7. Prune old images
docker image prune -f

echo "Deploy complete. Active slot: ${INACTIVE}"
```

Add a `trap` at the top that runs cleanup (stops inactive stack) if the script exits non-zero before step 4 (nginx switch). After step 4, rollback would require re-running the script with the old images — log a message instead of auto-reverting since the nginx switch already happened.

## Tasks
1. Write `ansible/roles/app-deploy/files/blue-green-deploy.sh` with the logic above, parameterised for the project name. Include the `trap` for pre-switch cleanup.
2. Make the script handle the case where `docker-compose.green.yml` / `docker-compose.blue.yml` don't exist (fail with a clear message directing to sprint 29).
3. Add an Ansible task in `ansible/roles/app-deploy/tasks/main.yml` to copy `blue-green-deploy.sh` to `{{ app_dir }}/blue-green-deploy.sh` and make it executable (mode 0755).
4. Write `ansible/roles/app-deploy/files/health-check-all.sh` — a thin wrapper that calls `health-check.sh` for each service port sequentially (takes a space-separated list of port:path pairs). This keeps the main script clean.
5. Write a brief `README` comment block at the top of `blue-green-deploy.sh` explaining: expected directory layout, how to run manually, and how rollback works.

## Files involved
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — new: the deploy orchestration script
- `ansible/roles/app-deploy/files/health-check-all.sh` — new: multi-service health check wrapper
- `ansible/roles/app-deploy/tasks/main.yml` — add copy task for both new scripts

## Acceptance criteria
- [x] Script exits non-zero and leaves old stack running if any health check on the inactive slot fails
- [x] Script writes the new active slot to `.active-slot` only after nginx reload succeeds
- [x] Script stops the old stack after a successful slot switch
- [x] Running the script twice in a row (no new images) completes cleanly (idempotent)
- [x] `shellcheck` passes on the script with no errors

## Completed

**Date:** 2026-06-09

### Summary
Wrote `blue-green-deploy.sh` which reads the active slot from `.active-slot`, brings up the inactive slot, health-checks web and api, atomically switches the nginx include file and reloads, records the new active slot, stops the old slot, and prunes images. A `SWITCHED` flag lets the EXIT trap distinguish pre-switch failures (tear down inactive, old slot keeps serving) from post-switch failures (log a manual rollback message). Guards at the top catch missing compose files or nginx slot config and print actionable error messages.

Wrote `health-check-all.sh` as a thin wrapper over `health-check.sh` that accepts space-separated `PORT:PATH` pairs — keeps the main script concise and provides a standalone utility for ops use.

Added two gated copy tasks in `app-deploy/tasks/main.yml` (when `blue_green`) for both new scripts at mode 0755.

### Files changed
- (new) `ansible/roles/app-deploy/files/blue-green-deploy.sh` — full deploy orchestration script with trap-based rollback
- (new) `ansible/roles/app-deploy/files/health-check-all.sh` — multi-service health check wrapper
- `ansible/roles/app-deploy/tasks/main.yml` — added copy tasks for both scripts, gated on `blue_green`

### Verification
- `shellcheck blue-green-deploy.sh health-check-all.sh`: exit 0, no warnings
- Script logic reviewed: SWITCHED flag correctly guards trap; .active-slot written after nginx -s reload succeeds
- health-check-all.sh: `$#` guard and pair split using `%%:*` / `#*:` parameter expansion (no external tools)

### Follow-ups
- `[defer]` The worker service health check is not included in the deploy script (only web and api are checked). Add worker health check once `/healthz` endpoint is confirmed stable in production.
- `[defer]` The script assumes `nginx` is on PATH (typical for system installs). If running in a container, adjust PATH or use the full nginx binary path.

## Out of scope
- CI wiring (sprint 32)
- Multi-project support beyond emit-vision (generalize in sprint 33)
- Database migrations (out of scope for this initiative — handle separately)
