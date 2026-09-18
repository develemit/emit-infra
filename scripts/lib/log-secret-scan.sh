# log-secret-scan.sh — detect leaked GitHub tokens in a captured CI/deploy log.
#
#   source "$HOME/projects/emit-infra/scripts/lib/log-secret-scan.sh"
#   emit_scan_log_for_secrets <file>   # prints a loud error and returns 1 on a match
#
# Guards against a repeat of the 2026-08 leak (fixed in sprint 317.3, residue
# purged in sprint 340): `no_log: true` hides a token from Ansible's own
# output, but nothing stopped an earlier bug from writing one into the
# ci-log-capture.sh mirror anyway. This scans the finished log file, not live
# output, so it can never itself echo the token it's rejecting.

[[ -n "${_EMIT_LOG_SECRET_SCAN_LOADED:-}" ]] && return 0
_EMIT_LOG_SECRET_SCAN_LOADED=1

# Covers every current GitHub token prefix (OAuth/PAT/server-to-server/
# user-to-server/refresh) plus fine-grained PATs. `gh auth token` issues
# gho_, the prefix seen in the sprint 340 leak.
_EMIT_TOKEN_PATTERN='gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'

emit_scan_log_for_secrets() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  if grep -qE "$_EMIT_TOKEN_PATTERN" "$file" 2>/dev/null; then
    echo "SECURITY: token pattern detected in captured log: $file" >&2
    echo "Refusing to leave a credential on disk — purge or scrub the file, then re-run." >&2
    return 1
  fi
  return 0
}
