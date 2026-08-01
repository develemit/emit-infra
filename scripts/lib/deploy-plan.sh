# deploy-plan.sh — decision logic for the shared pre-push deploy phase.
#
# Pure-ish helpers: they read git/nx/config state and echo a result or return a
# status. No status-file writes, no docker, no deploys — so they can be tested
# standalone (see deploy-plan.test.sh).
#
#   resolve_last_deployed_sha <root>        -> echoes sha of last successful deploy ('' if none)
#   deploy_ignore_specs <patterns...>       -> echoes git :(exclude) pathspecs, one per line
#   only_ignored_paths_changed <base> <patterns...>
#   nx_available                            -> 0 if this repo can answer nx graph queries
#   nx_projects [--affected --base=<sha>]   -> echoes project names, one per line
#   service_needs_build <svc> <base> <all_projects> <affected_projects> <extra_globs>
#   detect_dry_run_push                     -> 0 if the invoking `git push` used --dry-run

[[ -n "${_EMIT_DEPLOY_PLAN_LOADED:-}" ]] && return 0
_EMIT_DEPLOY_PLAN_LOADED=1

# Paths that never justify a build+deploy on their own. Projects override with
# ci.deployIgnorePaths or append with ci.deployIgnorePathsExtra.
EMIT_DEFAULT_DEPLOY_IGNORE_PATHS=(
  'sprint/**'
  'docs/**'
  'backlog.md'
  '*.md'
)

# Paths that force a rebuild of a service regardless of what the Nx graph says.
# '%s' is replaced with the service name.
EMIT_DEFAULT_BUILD_TRIGGER_PATHS=(
  'pnpm-lock.yaml'
  'apps/%s/Dockerfile'
  'apps/%s/infra/'
)

# ── fix 1: an interrupted deploy must not disable smart build ─────────────────
# .deploy-status.json only holds the *latest* run, so any failed/interrupted
# deploy leaves it in state "deploying" and hides the last known-good sha. Fall
# back to the newest "deployed" entry in .deploy-history.jsonl before giving up.
resolve_last_deployed_sha() {
  local root="${1:-.}"
  python3 - "$root" <<'PY' 2>/dev/null || true
import json, os, sys

root = sys.argv[1]
sha = ''

try:
    d = json.load(open(os.path.join(root, '.deploy-status.json')))
    if d.get('status') == 'deployed':
        sha = d.get('sha') or ''
except Exception:
    pass

if not sha:
    try:
        with open(os.path.join(root, '.deploy-history.jsonl')) as f:
            for line in reversed(f.readlines()):
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                if e.get('status') == 'deployed' and e.get('sha'):
                    sha = e['sha']
                    break
    except Exception:
        pass

print(sha)
PY
}

# ── fix 3: path filter ────────────────────────────────────────────────────────
# 'glob' magic makes '*' stop at '/', so '*.md' means root-level markdown only
# while 'docs/**' still matches recursively — which is what the defaults mean.
deploy_ignore_specs() {
  local p
  for p in "$@"; do
    printf ':(exclude,glob)%s\n' "$p"
  done
}

# True when every file changed since <base> matches an ignore pattern. Unknown
# paths always deploy; an empty pattern list never skips.
only_ignored_paths_changed() {
  local base="$1"; shift
  [[ $# -gt 0 ]] || return 1
  [[ -n "$base" ]] || return 1
  git rev-parse --quiet --verify "$base" >/dev/null 2>&1 || return 1

  # husky's hook wrapper runs this under `sh -e`, ignoring the bash shebang;
  # macOS's /bin/sh is bash in POSIX mode, which disables `<()` process
  # substitution. A captured-variable + here-string avoids it.
  local specs=() spec_list
  spec_list=$(deploy_ignore_specs "$@")
  while IFS= read -r spec; do specs+=("$spec"); done <<< "$spec_list"

  ! git diff --name-only "$base"..HEAD -- . "${specs[@]}" | grep -q .
}

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
  local paths=() p
  for p in "${EMIT_DEFAULT_BUILD_TRIGGER_PATHS[@]}"; do
    paths+=("${p//%s/$svc}")
  done
  for p in $extra; do
    paths+=("${p//%s/$svc}")
  done
  git diff --name-only "$base"..HEAD -- "${paths[@]}" 2>/dev/null | grep -q .
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
  # behavior — any change under the app or any package rebuilds it.
  git diff --name-only "$base"..HEAD -- "apps/$svc/" packages/ | grep -q .
}

# ── fix 4: `git push --dry-run` must not deploy ───────────────────────────────
# Git gives pre-push hooks no dry-run indicator, but the invoking `git push`
# process is an ancestor of this hook and its argv still carries the flag.
detect_dry_run_push() {
  local pid="${1:-$PPID}" depth=0 args
  while [[ "$pid" -gt 1 && $depth -lt 5 ]]; do
    args=$(ps -o args= -p "$pid" 2>/dev/null || true)
    if [[ "$args" == *" push"* ]]; then
      case " $args " in
        *" --dry-run "*|*" -n "*) return 0 ;;
      esac
      return 1
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [[ -n "$pid" ]] || return 1
    depth=$((depth + 1))
  done
  return 1
}
