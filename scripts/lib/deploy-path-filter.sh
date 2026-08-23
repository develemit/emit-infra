# deploy-path-filter.sh — decide whether a push touched only paths that never
# justify a build+deploy on their own.
#
#   deploy_ignore_specs <patterns...>       -> echoes git :(exclude) pathspecs, one per line
#   only_ignored_paths_changed <base> <patterns...>
#
# Pure helpers: no status-file writes, no docker, no deploys — testable
# standalone (see deploy-path-filter.test.sh).

[[ -n "${_EMIT_DEPLOY_PATH_FILTER_LOADED:-}" ]] && return 0
_EMIT_DEPLOY_PATH_FILTER_LOADED=1

# Paths that never justify a build+deploy on their own. Projects override with
# ci.deployIgnorePaths or append with ci.deployIgnorePathsExtra.
EMIT_DEFAULT_DEPLOY_IGNORE_PATHS=(
  'sprint/**'
  'docs/**'
  'backlog.md'
  '*.md'
)

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
  # in deploy-smart-build.sh; also closes the errored-diff hole for free.
  local out rc
  out=$(git diff --name-only "$base"..HEAD -- . "${specs[@]}" 2>/dev/null); rc=$?
  [[ $rc -eq 0 ]] || return 1   # diff failed => deploy, never skip
  [[ -z "$out" ]]               # empty => genuinely only ignored paths changed
}
