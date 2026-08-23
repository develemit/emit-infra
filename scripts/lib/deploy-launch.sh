# deploy-launch.sh — decide how (and whether) this push is allowed to launch a
# deploy: last-known-good sha, dry-run detection, and the unattended-shell gate.
#
#   resolve_last_deployed_sha <root>        -> echoes sha of last successful deploy ('' if none)
#   detect_dry_run_push                     -> 0 if the invoking `git push` used --dry-run
#   detect_unattended_shell                 -> 0 if a teardown-prone shell env marker is set
#   has_controlling_terminal                -> 0 if this process can open /dev/tty
#   deploy_launch_mode                      -> echoes "<mode> <marker>" for the status record
#   deploy_warn_deprecated_override         -> warns on stderr if only the old override name is set
#
# Pure helpers: no status-file writes, no docker, no deploys — testable
# standalone (see deploy-plan.test.sh, deploy-unattended-gate.test.sh).

[[ -n "${_EMIT_DEPLOY_LAUNCH_LOADED:-}" ]] && return 0
_EMIT_DEPLOY_LAUNCH_LOADED=1

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
# signal — see docs/DEPLOY-GATES.md#unattended-shell-gate for why
# `-e /dev/tty` was rejected as a detector (it's true even with no
# controlling terminal).
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
# docs/DEPLOY-GATES.md#unattended-shell-gate). Warning-only signal: absence alone never blocks,
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
