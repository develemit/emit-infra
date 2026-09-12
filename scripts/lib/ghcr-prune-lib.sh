# ghcr-prune-lib.sh — pure selection logic for scripts/ghcr-prune.sh (sprint 330).
#
#   _ghcrprune_read_deployed_sha <status-file>          -> echoes the deployed
#                                                          sha, or nothing if
#                                                          never deployed;
#                                                          returns 2 if the
#                                                          file exists but
#                                                          can't be parsed
#   _ghcrprune_collect_deployed_shas <projects-dir>     -> echoes one sha per
#                                                          line across every
#                                                          */.deploy-status.json;
#                                                          returns 1 (and prints
#                                                          nothing further) the
#                                                          moment any file
#                                                          fails to parse
#   _ghcrprune_select_prune_ids <keep> [protected-sha...]
#                                                        -> reads GHCR version
#                                                          objects on stdin,
#                                                          one JSON object per
#                                                          line (JSONL — what
#                                                          `gh api --paginate
#                                                          --jq '.[]'` emits;
#                                                          --paginate applies
#                                                          --jq per page, so a
#                                                          single combined
#                                                          array isn't safe to
#                                                          assume), echoes the
#                                                          ids to delete.
#                                                          Untagged versions
#                                                          are never selected
#                                                          — see the function
#                                                          comment below.
#
# Fixture-tested (no live API calls) in ghcr-prune.test.sh.

[[ -n "${_GHCRPRUNE_LIB_LOADED:-}" ]] && return 0
_GHCRPRUNE_LIB_LOADED=1

# A project that never deployed has no status file at all — that's a normal,
# quiet "nothing to protect", not a failure. A status file that exists but
# won't parse means we can no longer trust what that project has running, so
# callers must treat a non-zero return here as fatal to the whole protection
# set rather than silently skipping the project (sprint 330 task 5).
_ghcrprune_read_deployed_sha() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(2)
if d.get("status") == "deployed":
    print(d.get("sha") or "")
' "$file"
}

_ghcrprune_collect_deployed_shas() {
  local projects_dir="$1" dir status_file sha rc
  local -a shas=()
  for dir in "$projects_dir"/*/; do
    [[ -d "$dir" ]] || continue
    status_file="${dir}.deploy-status.json"
    [[ -f "$status_file" ]] || continue
    sha=$(_ghcrprune_read_deployed_sha "$status_file")
    rc=$?
    if [[ $rc -ne 0 ]]; then
      echo "ghcr-prune: $status_file exists but could not be parsed — refusing to trust the protection set" >&2
      return 1
    fi
    [[ -n "$sha" ]] && shas+=("$sha")
  done
  [[ ${#shas[@]} -gt 0 ]] && printf '%s\n' "${shas[@]}"
  return 0
}

# Reads the raw GHCR "list versions" JSON array on stdin. A version is
# protected (never selected) if any of its tags is exactly "latest", starts
# with "latest-" (variant tags like "latest-migrate"), or matches a
# currently-deployed sha. Only tagged, non-protected versions count toward
# $keep — untagged versions (attestation/provenance manifests, and platform
# manifests referenced by a tagged manifest list) never consume the budget
# and are never selected for deletion at all.
#
# Sprint 330 resume finding: an earlier version of this function deleted
# untagged versions by a time cutoff (strictly older than the oldest
# retained tagged version). That is unsafe — a manifest list retained by the
# count rule can have its own platform manifest, written a second later or
# earlier, land on the wrong side of that cutoff purely by timestamp, with
# no relationship to whether it's actually still referenced. Verified live
# against develemail-api: retained tags 578 and 578-migrate each had an
# untagged sibling below the cutoff that resolved to the real platform image
# manifest, not an attestation — deleting it would have left the tag
# unpullable. Proving "unreferenced" would require resolving every retained
# tagged version's manifest list, which this script doesn't do; the sprint's
# documented fallback is to leave untagged versions alone entirely once the
# accounting fix (excluding them from $keep) is in place, so that's what
# this does.
_ghcrprune_select_prune_ids() {
  local keep="$1"; shift
  local protected_json
  protected_json=$(python3 -c 'import json, sys; print(json.dumps(sys.argv[1:]))' "$@")
  python3 -c '
import json, sys

versions = [json.loads(line) for line in sys.stdin if line.strip()]
keep = int(sys.argv[1])
protected_shas = set(json.loads(sys.argv[2]))

def tags_of(v):
    return v.get("metadata", {}).get("container", {}).get("tags") or []

def is_protected(v):
    for t in tags_of(v):
        if t == "latest" or t.startswith("latest-") or t in protected_shas:
            return True
    return False

tagged = [v for v in versions if tags_of(v)]

eligible = [v for v in tagged if not is_protected(v)]
eligible.sort(key=lambda v: v["created_at"], reverse=True)

delete_ids = [v["id"] for v in eligible[keep:]]

for i in delete_ids:
    print(i)
' "$keep" "$protected_json"
}
