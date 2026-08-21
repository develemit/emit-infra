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
#   detect_unattended_shell                 -> 0 if a teardown-prone shell env marker is set
#   has_controlling_terminal                -> 0 if this process can open /dev/tty
#   deploy_launch_mode                      -> echoes "<mode> <marker>" for the status record
#   deploy_warn_deprecated_override         -> warns on stderr if only the old override name is set

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
#
# A blank/whitespace pattern is dropped, not turned into a spec: an empty
# ':(exclude,glob)' isn't a no-op, git treats it as matching every path, so
# one blank pattern would silently exclude everything (confirmed
# empirically). Unreachable today via only_ignored_paths_changed's `$# -gt 0`
# guard, but cheap to close (sprint 292).
deploy_ignore_specs() {
  local p
  for p in "$@"; do
    [[ -n "${p//[[:space:]]/}" ]] || continue
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
  # substitution. A captured-variable + here-string avoids it. A here-string
  # of an empty spec_list is a single newline, so the read loop would append
  # one empty-string element — filtered here too, on top of
  # deploy_ignore_specs's own filtering above.
  local specs=() spec_list spec
  spec_list=$(deploy_ignore_specs "$@")
  while IFS= read -r spec; do
    [[ -n "$spec" ]] && specs+=("$spec")
  done <<< "$spec_list"

  # No pipe into grep: `grep -q` closes the pipe the instant it sees a match,
  # which killed `git diff` with SIGPIPE (exit 141) on large output. Under
  # `set -o pipefail` (pre-push line 6) that promoted to the pipeline's
  # status and `!` read it as "only ignored paths changed" — a skip that got
  # *more* likely the bigger the diff was (sprint 292; ~16KB pipe-buffer
  # threshold, reproduced 5/5). Same capture-then-check shape as nx_projects
  # above; also closes the errored-diff hole for free.
  local out rc
  out=$(git diff --name-only "$base"..HEAD -- . "${specs[@]}" 2>/dev/null); rc=$?
  [[ $rc -eq 0 ]] || return 1   # diff failed => deploy, never skip
  [[ -z "$out" ]]               # empty => genuinely only ignored paths changed
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
  local paths=() p out rc
  for p in "${EMIT_DEFAULT_BUILD_TRIGGER_PATHS[@]}"; do
    paths+=("${p//%s/$svc}")
  done
  for p in $extra; do
    paths+=("${p//%s/$svc}")
  done
  # Same pipe-into-grep SIGPIPE shape as only_ignored_paths_changed above (sprint 292).
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
  # pipe-into-grep SIGPIPE hazard as only_ignored_paths_changed (sprint 292).
  local out rc
  out=$(git diff --name-only "$base"..HEAD -- "apps/$svc/" packages/ 2>/dev/null); rc=$?
  [[ $rc -eq 0 ]] || return 0   # diff failed => build, never skip one
  [[ -n "$out" ]]
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

# ── fix 7: refuse to deploy from a shell that can be torn down mid-build ─────
# 2026-08-19 incident: an emit-social deploy launched from an agent session's
# background shell got killed mid-build, leaving .deploy-status.json frozen at
# "deploying" while prod was never touched. Env markers are the reliable
# signal — see docs/PRE-PUSH-HOOK.md for why `-e /dev/tty` was rejected as a
# detector (it's true even with no controlling terminal).
#
# Keep this list in one place so it's easy to extend as new ephemeral-shell
# markers are identified.
EMIT_UNATTENDED_SHELL_MARKERS=(CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI)

detect_unattended_shell() {
  local var
  for var in "${EMIT_UNATTENDED_SHELL_MARKERS[@]}"; do
    [[ -n "${!var:-}" ]] && { echo "$var"; return 0; }
  done
  return 1
}

# Actually *opening* the controlling terminal, not just checking the device
# node exists (`-e /dev/tty` is true even with no controlling terminal — see
# docs/PRE-PUSH-HOOK.md). Warning-only signal: absence alone never blocks,
# since GUI git clients (VSCode, Tower, GitHub Desktop) have no controlling
# terminal either and are a normal, safe workflow.
has_controlling_terminal() {
  ( : < /dev/tty ) 2>/dev/null
}

# ── fix 8: stamp how a deploy was launched onto the status record (sprint 290) ─
# Not auto-detectable (macOS bash 3.2: no inherited ignored SIGHUP visible to
# the child, no setsid, nohup leaves pgid unchanged) — a declaration, not a
# proof. EMIT_DEPLOY_DETACHED=1 asserts a property the caller owns ("this
# will outlive me"); the deprecated EMIT_ALLOW_UNATTENDED_DEPLOY alias stamps
# "unattended-override" instead of "detached" so a post-mortem grepping
# .deploy-history.jsonl can tell which path a deploy actually took.
deploy_launch_mode() {
  local marker
  marker=$(detect_unattended_shell) || true
  if [[ "${EMIT_DEPLOY_DETACHED:-0}" == "1" ]]; then
    echo "detached ${marker}"
  elif [[ "${EMIT_ALLOW_UNATTENDED_DEPLOY:-0}" == "1" ]]; then
    echo "unattended-override ${marker}"
  else
    echo "interactive ${marker}"
  fi
}

# Only the deprecated alias reads as "skip the check" — warn when it's the
# only thing set, nudging muscle memory toward the honest name.
deploy_warn_deprecated_override() {
  if [[ "${EMIT_DEPLOY_DETACHED:-0}" != "1" && "${EMIT_ALLOW_UNATTENDED_DEPLOY:-0}" == "1" ]]; then
    echo "⚠ pre-push: EMIT_ALLOW_UNATTENDED_DEPLOY is deprecated; set EMIT_DEPLOY_DETACHED=1 instead (scripts/deploy-detached.sh already does)" >&2
  fi
}

# ── fix 5: build-fan-out failures must always reach on_fail ──────────────────
# `wait "$pid" || exit 1` used to guard the build loop, relying on the ERR
# trap to run `deploy_done failed` on the way out. It doesn't: `wait` sits on
# the left of `||` so its failure never fires the trap, and the explicit
# `exit` that follows doesn't fire it either — a failed backgrounded build
# left .deploy-status.json stuck at "deploying" forever (sprint 267). Calling
# on_fail directly removes the dependency on trap semantics entirely.
run_build_fanout() {
  local max_parallel="$1" on_fail="$2"; shift 2
  local pids=() pid svc
  for svc in "$@"; do
    build_image "$svc" &
    pids+=($!)
    if [[ ${#pids[@]} -ge $max_parallel ]]; then
      for pid in "${pids[@]}"; do wait "$pid" || "$on_fail"; done
      pids=()
    fi
  done
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" || "$on_fail"; done
}

# ── fix 6: surface what a push to main is about to ship ──────────────────────
# A month-old local commit rode along silently in a "safe" test push
# (develemail, sprint 252 near-miss). Print commit count + oldest commit's
# age/subject from the range git already handed the hook on stdin —
# informational only, never gates or prompts.
push_payload_summary() {
  local remote_sha="$1" local_sha="$2"
  # git's pre-push protocol sends 40 zeros for "no such ref on the remote yet"
  # (new branch). `git rev-parse --verify` treats that as syntactically valid
  # and echoes it straight back rather than failing, so it needs its own check.
  if [[ -z "$remote_sha" ]] || [[ "$remote_sha" =~ ^0+$ ]] || \
     ! git rev-parse --quiet --verify "$remote_sha" >/dev/null 2>&1; then
    echo "→ shipping ${local_sha:0:7} (new branch; no remote history to compare)"
    return 0
  fi
  local count oldest
  count=$(git rev-list --count "$remote_sha..$local_sha")
  oldest=$(git log --reverse --format='%ar — %s' "$remote_sha..$local_sha" | head -1)
  echo "→ shipping $count commit(s); oldest: $oldest"
}
