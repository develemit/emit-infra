#!/usr/bin/env bash
# blue-green-deploy.sh — Zero-downtime deploy for emit-infra blue-green projects.
#
# Usage:
#   ./blue-green-deploy.sh [PROJECT]
#   PROJECT defaults to "emit-vision"
#
# Expected layout at /opt/<PROJECT>/:
#   docker-compose.app.yml    — base app services (no port bindings)
#   docker-compose.blue.yml   — blue slot port overrides (web:4300 api:4301 worker:4302 marketing:4303)
#   docker-compose.green.yml  — green slot port overrides (web:4400 api:4401 worker:4402 marketing:4403)
#   .env                      — shared env file (loaded by compose)
#   .active-slot              — "blue" or "green"; created on first deploy
#   health-check.sh           — per-port HTTP health check (copied by Ansible)
#
# How rollback works:
#   Pre-switch failure  : script exits non-zero; old slot keeps serving; inactive stack is
#                         torn down automatically by the trap.
#   Post-switch failure : nginx already points to the new slot; log message is printed.
#                         To roll back, redeploy with the previous image tag.
set -euo pipefail

PROJECT="${1:-emit-vision}"
APP_DIR="/opt/${PROJECT}"
SLOT_FILE="${APP_DIR}/.active-slot"
COMPOSE_APP="${APP_DIR}/docker-compose.app.yml"
NGINX_SLOT_CONF="/etc/nginx/blue-green/${PROJECT}.conf"

# ── Guard: required files must exist ─────────────────────────────────────────
for f in "$COMPOSE_APP" "${APP_DIR}/docker-compose.blue.yml" "${APP_DIR}/docker-compose.green.yml"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: Required file missing: $f"
    echo "Run the sprint-29 dual-stack compose layout to create it."
    exit 1
  fi
done

if [ ! -f "$NGINX_SLOT_CONF" ]; then
  echo "ERROR: nginx slot config not found: $NGINX_SLOT_CONF"
  echo "Run the nginx Ansible role with blue_green=true to initialise it."
  exit 1
fi

# ── Determine active and inactive slots ──────────────────────────────────────
ACTIVE=$(cat "$SLOT_FILE" 2>/dev/null || echo "blue")
if [ "$ACTIVE" = "blue" ]; then
  INACTIVE="green"
  INACTIVE_WEB=4400
  INACTIVE_API=4401
  INACTIVE_WORKER=4402
  INACTIVE_MARKETING=4403
else
  INACTIVE="blue"
  INACTIVE_WEB=4300
  INACTIVE_API=4301
  INACTIVE_WORKER=4302
  INACTIVE_MARKETING=4303
fi

INACTIVE_COMPOSE="${APP_DIR}/docker-compose.${INACTIVE}.yml"
INACTIVE_PROJECT="${PROJECT}-${INACTIVE}"
ACTIVE_PROJECT="${PROJECT}-${ACTIVE}"

echo "==> Deploy: active=${ACTIVE} → new=${INACTIVE}"

# ── Trap: clean up inactive slot on pre-switch failure ───────────────────────
# SWITCHED=0 means the nginx reload has not happened yet; safe to tear down.
SWITCHED=0
cleanup() {
  local exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    return
  fi
  if [ "$SWITCHED" -eq 0 ]; then
    echo "==> Deploy failed before nginx switch. Stopping ${INACTIVE} slot..."
    docker compose -f "$COMPOSE_APP" -f "$INACTIVE_COMPOSE" \
      --env-file "${APP_DIR}/.env" \
      --project-name "$INACTIVE_PROJECT" down 2>/dev/null || true
    echo "==> Old slot (${ACTIVE}) is still serving traffic."
  else
    echo "==> Deploy failed after nginx switch. nginx now points to ${INACTIVE}."
    echo "==> To roll back, redeploy the previous image tag."
  fi
}
trap cleanup EXIT

# ── 1. Pull new images ────────────────────────────────────────────────────────
echo "==> Pulling images for ${INACTIVE} slot..."
docker compose -f "$COMPOSE_APP" -f "$INACTIVE_COMPOSE" \
  --env-file "${APP_DIR}/.env" pull

# ── 2. Start inactive slot ────────────────────────────────────────────────────
echo "==> Starting ${INACTIVE} slot..."
docker compose -f "$COMPOSE_APP" -f "$INACTIVE_COMPOSE" \
  --env-file "${APP_DIR}/.env" \
  --project-name "$INACTIVE_PROJECT" up -d --remove-orphans

# ── 3. Health check inactive slot ────────────────────────────────────────────
echo "==> Health checking ${INACTIVE} slot (web:${INACTIVE_WEB} api:${INACTIVE_API})..."
"${APP_DIR}/health-check.sh" "$INACTIVE_WEB" 20 "/" 5
"${APP_DIR}/health-check.sh" "$INACTIVE_API" 20 "/readyz" 5

# ── 4. Switch nginx to inactive slot ─────────────────────────────────────────
echo "==> Switching nginx to ${INACTIVE} slot..."
cat > "$NGINX_SLOT_CONF" <<NGINX_UPSTREAM
# Active slot: ${INACTIVE} — written by blue-green-deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
upstream ${PROJECT}_web      { server 127.0.0.1:${INACTIVE_WEB}; }
upstream ${PROJECT}_api      { server 127.0.0.1:${INACTIVE_API}; }
upstream ${PROJECT}_worker   { server 127.0.0.1:${INACTIVE_WORKER}; }
upstream ${PROJECT}_marketing { server 127.0.0.1:${INACTIVE_MARKETING}; }
NGINX_UPSTREAM

nginx -t && nginx -s reload
SWITCHED=1

# ── 5. Record new active slot ─────────────────────────────────────────────────
echo "$INACTIVE" > "$SLOT_FILE"
date +%s > "$APP_DIR/.deployed-at"

# ── 6. Stop old slot ──────────────────────────────────────────────────────────
echo "==> Stopping old ${ACTIVE} slot..."
docker compose -f "$COMPOSE_APP" \
  -f "${APP_DIR}/docker-compose.${ACTIVE}.yml" \
  --env-file "${APP_DIR}/.env" \
  --project-name "$ACTIVE_PROJECT" stop

# ── 7. Prune old images ───────────────────────────────────────────────────────
docker image prune -f

echo "==> Deploy complete. Active slot: ${INACTIVE}"
