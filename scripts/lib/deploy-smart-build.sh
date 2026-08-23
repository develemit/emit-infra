# deploy-smart-build.sh — dependency-aware "does this service need a rebuild"
# decision, backed by the Nx project graph when available.
#
#   nx_available                            -> 0 if this repo can answer nx graph queries
#   nx_projects [--affected --base=<sha>]   -> echoes project names, one per line
#   service_needs_build <svc> <base> <all_projects> <affected_projects> <extra_globs>
#
# Pure helpers: no status-file writes, no docker, no deploys — testable
# standalone (see deploy-plan.test.sh).

[[ -n "${_EMIT_DEPLOY_SMART_BUILD_LOADED:-}" ]] && return 0
_EMIT_DEPLOY_SMART_BUILD_LOADED=1

# Paths that force a rebuild of a service regardless of what the Nx graph says.
# '%s' is replaced with the service name.
EMIT_DEFAULT_BUILD_TRIGGER_PATHS=(
  'pnpm-lock.yaml'
  'apps/%s/Dockerfile'
  'apps/%s/infra/'
)

# ── fix 2: dependency-aware rebuilds ──────────────────────────────────────────
nx_available() { [[ -f nx.json ]]; }

# Echoes project names, one per line, and preserves nx's exit status.
# Distinguishing "nx failed" from "nx says nothing is affected" matters:
# swallowing an error would look like an empty affected set and silently skip
# every rebuild.
#
# nx prints a JSON array when stdout isn't a TTY (always, under a git hook) and
# newline-separated names when it is, so accept both.
nx_projects() {
  local out rc
  out=$(pnpm nx show projects "$@" 2>/dev/null)
  rc=$?
  [[ $rc -eq 0 ]] || return $rc
  printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    names = json.loads(raw)
    if not isinstance(names, list):
        raise ValueError
except Exception:
    names = raw.splitlines()
for n in names:
    n = str(n).strip()
    if n:
        print(n)
'
}

_list_has() {
  local needle="$1" list="$2" item
  while IFS= read -r item; do
    [[ "$item" == "$needle" ]] && return 0
  done <<< "$list"
  return 1
}

_trigger_paths_changed() {
  local svc="$1" base="$2" extra="$3"
  local paths=() p out rc
  for p in "${EMIT_DEFAULT_BUILD_TRIGGER_PATHS[@]}"; do
    paths+=("${p//%s/$svc}")
  done
  for p in $extra; do
    paths+=("${p//%s/$svc}")
  done
  # Same pipe-into-grep SIGPIPE shape as only_ignored_paths_changed
  # (deploy-path-filter.sh, sprint 292).
  out=$(git diff --name-only "$base"..HEAD -- "${paths[@]}" 2>/dev/null); rc=$?
  [[ $rc -eq 0 ]] || return 0   # diff failed => trigger a build, never skip one
  [[ -n "$out" ]]
}

# Decide whether one service must be rebuilt.
#   $3 all_projects      newline list from `nx show projects` ('' when non-Nx)
#   $4 affected_projects newline list from `nx show projects --affected` ('' when non-Nx)
#   $5 extra_globs       space-separated ci.buildTriggerPaths entries
#
# Safe defaults, in order: no base sha -> build; unconditional trigger path
# touched -> build; service is not a resolvable Nx project -> fall back to the
# old coarse glob. Only when nx *can* answer for this service do we trust it.
service_needs_build() {
  local svc="$1" base="$2" all_projects="$3" affected_projects="$4" extra="${5:-}"

  if [[ -z "$base" ]] || ! git rev-parse --quiet --verify "$base" >/dev/null 2>&1; then
    return 0
  fi

  _trigger_paths_changed "$svc" "$base" "$extra" && return 0

  if [[ -n "$all_projects" ]] && _list_has "$svc" "$all_projects"; then
    _list_has "$svc" "$affected_projects"
    return $?
  fi

  # Non-Nx project, or a service whose name isn't an Nx project: original
  # behavior — any change under the app or any package rebuilds it. Same
  # pipe-into-grep SIGPIPE hazard as only_ignored_paths_changed
  # (deploy-path-filter.sh, sprint 292).
  local out rc
  out=$(git diff --name-only "$base"..HEAD -- "apps/$svc/" packages/ 2>/dev/null); rc=$?
  [[ $rc -eq 0 ]] || return 0   # diff failed => build, never skip one
  [[ -n "$out" ]]
}
