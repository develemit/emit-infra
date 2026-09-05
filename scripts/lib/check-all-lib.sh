# check-all-lib.sh — config readers for the shared check-all runner.
#
# Per-repo variation lives in .emit-infra.json under ci.checkAll (all keys
# optional; targets fall back to ci.prePush minus "format", then to the
# standard four). Behavior lives in scripts/check-all.sh. Same split the
# pre-push hook uses.
#
#   "ci": {
#     "checkAll": {
#       "preflight": ["pnpm generate:contracts"],   // serial, before targets
#       "targets":   ["lint","typecheck","test","build"],  // one nx invocation
#       "format":    "pnpm format",                 // "" / false to skip
#       "e2e":       "pnpm e2e",                    // command for the e2e phase
#       "exclude":   ["workspace"],                 // nx --exclude list
#       "parallel":  2                              // nx --parallel
#     }
#   }

[[ -n "${_EMIT_CHECK_ALL_LIB_LOADED:-}" ]] && return 0
_EMIT_CHECK_ALL_LIB_LOADED=1

# All readers take the config path and print the resolved value. python3 does
# the JSON work — same convention as the runner-detection in start-sprint-auto.
_ca_read() {
  local config="$1" expr="$2" fallback="$3"
  python3 - "$config" "$fallback" <<PYEOF 2>/dev/null || echo "$fallback"
import json, sys
try:
    c = json.load(open(sys.argv[1]))
except Exception:
    print(sys.argv[2]); raise SystemExit
ca = c.get("ci", {}).get("checkAll", {}) or {}
pre_push = c.get("ci", {}).get("prePush") or []
${expr}
PYEOF
}

_ca_targets() {
  # format and e2e are never run-many targets here: format is a repo-wide
  # command (nx affected -t format silently no-ops), and e2e must run in its
  # own serial phase — folded into the parallel run it loses races against
  # the other stages (the exact failure the per-repo forks serialized).
  _ca_read "$1" '
t = ca.get("targets") or [x for x in pre_push] or ["lint", "typecheck", "test", "build"]
t = [x for x in t if x not in ("format", "e2e")]
print(" ".join(t))' "lint typecheck test build"
}

_ca_preflight() {
  # One command per line; empty output means no preflight.
  _ca_read "$1" '
for cmd in ca.get("preflight") or []:
    print(cmd)' ""
}

_ca_format_cmd() {
  # Prints the format command, or nothing when disabled / not configured and
  # prePush does not ask for format.
  _ca_read "$1" '
f = ca.get("format")
if f is False or f == "":
    pass
elif isinstance(f, str):
    print(f)
elif "format" in pre_push:
    print("pnpm format")' ""
}

_ca_e2e_cmd() {
  _ca_read "$1" '
e = ca.get("e2e")
print(e if isinstance(e, str) and e else "pnpm exec nx run-many -t e2e --parallel=1")' \
    "pnpm exec nx run-many -t e2e --parallel=1"
}

_ca_exclude_args() {
  _ca_read "$1" '
ex = ca.get("exclude") or []
print(" ".join(f"--exclude={x}" for x in ex))' ""
}

_ca_parallel() {
  _ca_read "$1" '
p = ca.get("parallel")
print(p if isinstance(p, int) and p > 0 else 2)' "2"
}
