#!/usr/bin/env bash
# blue-green-deploy.sh — Config-driven zero-downtime deploy for any emit-infra project.
#
# Usage:
#   ./blue-green-deploy.sh [PROJECT] [--dry-run]
#   PROJECT defaults to "emit-vision"
#
# Config:
#   Sources /opt/<PROJECT>/.deploy-config for project-specific values.
#   Falls back to emit-vision defaults if no config exists.
#
# How rollback works:
#   Pre-switch failure  : script exits non-zero; old slot keeps serving; inactive stack is
#                         torn down automatically by the trap.
#   Post-switch failure : nginx already points to the new slot; log message is printed.
#                         To roll back, redeploy with the previous image tag.
set -euo pipefail

DRY_RUN=0
PROJECT=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) [ -z "$PROJECT" ] && PROJECT="$arg" ;;
  esac
done
PROJECT="${PROJECT:-emit-vision}"

APP_DIR="/opt/${PROJECT}"
CONFIG_FILE="${APP_DIR}/.deploy-config"
SLOT_FILE="${APP_DIR}/.active-slot"

# ── Load config (defaults = emit-vision layout) ──────────────────────────────
SERVICES="web api worker marketing"
PORTS_BLUE="4300 4301 4302 4303"
PORTS_GREEN="4400 4401 4402 4403"
HEALTH_CHECKS="/ /readyz skip skip"
HEALTH_RETRIES=20
HEALTH_INTERVAL=5
COMPOSE_STRUCTURE="separate"
COMPOSE_APP="${APP_DIR}/docker-compose.app.yml"
COMPOSE_FILE=""
NGINX_CONF_PATH="/etc/nginx/blue-green/${PROJECT}.conf"
MIGRATE_PRE=""
MIGRATE_POST=""
POST_EXEC=""
PRUNE_STRATEGY="standard"
SLOT_GRACE_SECONDS=0
VERSION_FILE=""

if [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  echo "==> Loaded config from ${CONFIG_FILE}"
else
  echo "==> No config at ${CONFIG_FILE}, using defaults (emit-vision)"
fi

# Convert space-separated strings to arrays
read -ra SVC_ARR <<< "$SERVICES"
read -ra BLUE_ARR <<< "$PORTS_BLUE"
read -ra GREEN_ARR <<< "$PORTS_GREEN"
read -ra HC_ARR <<< "$HEALTH_CHECKS"

SVC_COUNT=${#SVC_ARR[@]}

if [ "${#BLUE_ARR[@]}" -ne "$SVC_COUNT" ] || [ "${#GREEN_ARR[@]}" -ne "$SVC_COUNT" ]; then
  echo "ERROR: SERVICES (${SVC_COUNT}), PORTS_BLUE (${#BLUE_ARR[@]}), PORTS_GREEN (${#GREEN_ARR[@]}) count mismatch"
  exit 1
fi

# ── Determine active and inactive slots ───────────────────────────────────────
ACTIVE=$(cat "$SLOT_FILE" 2>/dev/null || echo "blue")
if [ "$ACTIVE" = "blue" ]; then
  INACTIVE="green"
  PORTS_ARR=("${GREEN_ARR[@]}")
else
  INACTIVE="blue"
  PORTS_ARR=("${BLUE_ARR[@]}")
fi

echo "==> Deploy: active=${ACTIVE} -> new=${INACTIVE} (${SVC_COUNT} services)"

# For "separate" structure: if COMPOSE_APP doesn't exist on disk, the slot
# files are self-contained (e.g. develemail has no app.yml overlay).
if [ "$COMPOSE_STRUCTURE" != "profiles" ] && [ -n "$COMPOSE_APP" ] && [ ! -f "$COMPOSE_APP" ]; then
  COMPOSE_APP=""
fi

# ── Dry run: print plan and exit ──────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "DRY RUN — planned actions for ${PROJECT}:"
  echo "  Compose structure: ${COMPOSE_STRUCTURE}"
  if [ "$COMPOSE_STRUCTURE" = "profiles" ]; then
    echo "  Compose file: ${COMPOSE_FILE}"
    echo "  Compose up: docker compose -f ${COMPOSE_FILE} --profile ${INACTIVE} up -d"
  elif [ -n "$COMPOSE_APP" ]; then
    echo "  Compose app: ${COMPOSE_APP}"
    echo "  Compose slot: ${APP_DIR}/docker-compose.${INACTIVE}.yml"
    echo "  Compose up: docker compose -f ${COMPOSE_APP} -f docker-compose.${INACTIVE}.yml up -d"
  else
    echo "  Compose slot: ${APP_DIR}/docker-compose.${INACTIVE}.yml (self-contained)"
    echo "  Compose up: docker compose -f docker-compose.${INACTIVE}.yml up -d"
  fi
  echo "  Services:"
  for i in $(seq 0 $((SVC_COUNT - 1))); do
    hc="${HC_ARR[$i]:-skip}"
    echo "    ${SVC_ARR[$i]}: port ${PORTS_ARR[$i]} health=${hc}"
  done
  [ -n "$MIGRATE_PRE" ] && echo "  Pre-migration: ${MIGRATE_PRE}"
  [ -n "$MIGRATE_POST" ] && echo "  Post-migration: ${MIGRATE_POST}"
  echo "  Nginx config: ${NGINX_CONF_PATH}"
  echo "  Prune strategy: ${PRUNE_STRATEGY}"
  echo ""
  echo "DRY RUN complete — no changes made."
  exit 0
fi

# ── Build compose command helpers ─────────────────────────────────────────────
compose_cmd_inactive() {
  if [ "$COMPOSE_STRUCTURE" = "profiles" ]; then
    echo "docker compose -f ${COMPOSE_FILE} --env-file ${APP_DIR}/.env --profile ${INACTIVE}"
  elif [ -n "$COMPOSE_APP" ]; then
    echo "docker compose -f ${COMPOSE_APP} -f ${APP_DIR}/docker-compose.${INACTIVE}.yml --env-file ${APP_DIR}/.env --project-name ${PROJECT}-${INACTIVE}"
  else
    echo "docker compose -f ${APP_DIR}/docker-compose.${INACTIVE}.yml --env-file ${APP_DIR}/.env --project-name ${PROJECT}-${INACTIVE}"
  fi
}

compose_cmd_active() {
  if [ "$COMPOSE_STRUCTURE" = "profiles" ]; then
    echo "docker compose -f ${COMPOSE_FILE} --env-file ${APP_DIR}/.env --profile ${ACTIVE}"
  elif [ -n "$COMPOSE_APP" ]; then
    echo "docker compose -f ${COMPOSE_APP} -f ${APP_DIR}/docker-compose.${ACTIVE}.yml --env-file ${APP_DIR}/.env --project-name ${PROJECT}-${ACTIVE}"
  else
    echo "docker compose -f ${APP_DIR}/docker-compose.${ACTIVE}.yml --env-file ${APP_DIR}/.env --project-name ${PROJECT}-${ACTIVE}"
  fi
}

# In the profiles structure, un-profiled shared services (postgres, backups)
# are always enabled, so an unscoped stop/down would take them down with the
# slot. Returns the slot's service names to scope those commands; empty for
# the separate structure, whose per-slot project names already isolate it.
slot_scope() {
  local slot="$1"
  if [ "$COMPOSE_STRUCTURE" = "profiles" ]; then
    local s out=""
    for s in "${SVC_ARR[@]}"; do out="$out ${s}-${slot}"; done
    echo "$out"
  fi
}

# ── Trap: clean up inactive slot on pre-switch failure ────────────────────────
SWITCHED=0
cleanup() {
  local exit_code=$?
  if [ "$exit_code" -eq 0 ]; then return; fi
  if [ "$SWITCHED" -eq 0 ]; then
    echo "==> Deploy failed before nginx switch. Stopping ${INACTIVE} slot..."
    if [ "$COMPOSE_STRUCTURE" = "profiles" ]; then
      $(compose_cmd_inactive) stop $(slot_scope "$INACTIVE") 2>/dev/null || true
    else
      $(compose_cmd_inactive) down 2>/dev/null || true
    fi
    echo "==> Old slot (${ACTIVE}) is still serving traffic."
  else
    echo "==> Deploy failed after nginx switch. nginx now points to ${INACTIVE}."
    echo "==> To roll back, redeploy the previous image tag."
  fi
}
trap cleanup EXIT

# ── 1. Pre-deploy migration ──────────────────────────────────────────────────
if [ -n "$MIGRATE_PRE" ]; then
  echo "==> Running pre-deploy migration..."
  eval "$MIGRATE_PRE"
fi

# ── 2. Pull new images ───────────────────────────────────────────────────────
echo "==> Pulling images for ${INACTIVE} slot..."
$(compose_cmd_inactive) pull

# ── 3. Start inactive slot ───────────────────────────────────────────────────
echo "==> Starting ${INACTIVE} slot..."
$(compose_cmd_inactive) up -d --remove-orphans

# ── 4. Health check inactive slot ─────────────────────────────────────────────
for i in $(seq 0 $((SVC_COUNT - 1))); do
  hc="${HC_ARR[$i]:-skip}"
  if [ "$hc" = "skip" ]; then
    echo "==> Health check: ${SVC_ARR[$i]} — skipped"
    continue
  fi

  port="${PORTS_ARR[$i]}"
  echo "==> Health checking ${SVC_ARR[$i]} at port ${port}${hc} (${HEALTH_RETRIES} attempts, ${HEALTH_INTERVAL}s interval)..."

  ok=0
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}${hc}" 2>/dev/null || echo "000")
    if [[ "$status" =~ ^[23] ]]; then
      echo "    ${SVC_ARR[$i]} healthy (HTTP ${status}) on attempt ${attempt}"
      ok=1
      break
    fi
    sleep "$HEALTH_INTERVAL"
  done

  if [ "$ok" -eq 0 ]; then
    echo "ERROR: ${SVC_ARR[$i]} failed health check after ${HEALTH_RETRIES} attempts"
    exit 1
  fi
done

# ── 5. Switch nginx to inactive slot ──────────────────────────────────────────
echo "==> Switching nginx to ${INACTIVE} slot..."

upstream_block="# Active slot: ${INACTIVE} — written by blue-green-deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
for i in $(seq 0 $((SVC_COUNT - 1))); do
  svc="${SVC_ARR[$i]}"
  port="${PORTS_ARR[$i]}"
  upstream_block="${upstream_block}
upstream ${PROJECT}_${svc} { server 127.0.0.1:${port}; }"
done

mkdir -p "$(dirname "$NGINX_CONF_PATH")"

if [ -f "$NGINX_CONF_PATH" ]; then
  cp "$NGINX_CONF_PATH" "${NGINX_CONF_PATH}.bak"
fi

echo "$upstream_block" > "$NGINX_CONF_PATH"

if ! nginx -t; then
  echo "ERROR: nginx config validation failed after writing new upstream block"
  if [ -f "${NGINX_CONF_PATH}.bak" ]; then
    echo "==> Restoring previous nginx config from backup..."
    cp "${NGINX_CONF_PATH}.bak" "$NGINX_CONF_PATH"
    nginx -t || echo "WARNING: restored config also fails validation"
  fi
  exit 1
fi

nginx -s reload
SWITCHED=1
rm -f "${NGINX_CONF_PATH}.bak"

# ── 6. Record new active slot ────────────────────────────────────────────────
echo "$INACTIVE" > "$SLOT_FILE"
date +%s > "${APP_DIR}/.deployed-at"
[ -n "$VERSION_FILE" ] && cp "$VERSION_FILE" "${APP_DIR}/.deployed-version" 2>/dev/null || true

# ── 7. Post-deploy migration ─────────────────────────────────────────────────
if [ -n "$MIGRATE_POST" ]; then
  echo "==> Running post-deploy migration..."
  eval "$MIGRATE_POST"
fi

# ── 7b. Post-deploy exec commands (service:command pairs) ─────────────────────
if [ -n "$POST_EXEC" ]; then
  IFS='|' read -ra EXEC_ENTRIES <<< "$POST_EXEC"
  for entry in "${EXEC_ENTRIES[@]}"; do
    svc="${entry%%:*}"
    cmd="${entry#*:}"
    echo "==> Post-deploy exec: ${svc} → ${cmd}"
    $(compose_cmd_inactive) exec -T "$svc" $cmd
  done
fi

# ── 8. Grace period before stopping old slot ──────────────────────────────────
if [ "$SLOT_GRACE_SECONDS" -gt 0 ]; then
  echo "==> Waiting ${SLOT_GRACE_SECONDS}s before stopping old slot..."
  sleep "$SLOT_GRACE_SECONDS"
fi

# ── 9. Stop old slot ─────────────────────────────────────────────────────────
echo "==> Stopping old ${ACTIVE} slot..."
$(compose_cmd_active) stop $(slot_scope "$ACTIVE")

# ── 10. Prune ─────────────────────────────────────────────────────────────────
if [ "$PRUNE_STRATEGY" = "aggressive" ]; then
  docker container prune -f --filter "until=24h" 2>/dev/null || true
  docker image prune -a -f --filter "until=24h" 2>/dev/null || true
else
  docker image prune -f 2>/dev/null || true
fi

echo "==> Deploy complete. Active slot: ${INACTIVE}"
