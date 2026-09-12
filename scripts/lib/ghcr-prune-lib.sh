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
#   _ghcrprune_has_delete_scope <gh-auth-status-text>   -> true if the text
#                                                          (as printed by `gh
#                                                          auth status`) lists
#                                                          the delete:packages
#                                                          scope
#   _ghcrprune_delete_one <base> <encoded-pkg> <id>     -> issues one live
#                                                          DELETE; rc 0
#                                                          deleted, rc 2 an
#                                                          auth/scope failure
#                                                          (403), rc 1 any
#                                                          other failure. A
#                                                          standalone function
#                                                          (sprint 330.1) so
#                                                          tests can override
#                                                          it with a fake
#                                                          instead of calling
#                                                          `gh` for real.
#   _ghcrprune_delete_ids <base> <encoded-pkg> <id...>  -> calls
#                                                          _ghcrprune_delete_one
#                                                          per id, echoes
#                                                          "<deleted> <failed>
#                                                          <auth_stopped>" (the
#                                                          last field 1 if an
#                                                          auth/scope failure
#                                                          cut the run short).
#   _ghcrprune_discover_packages <projects-dir>         -> walks every
#                                                          */.emit-infra.json
#                                                          under the given
#                                                          dir and echoes one
#                                                          "<owner><TAB>
#                                                          <package>" line per
#                                                          declared
#                                                          blueGreen.services
#                                                          entry, reusing
#                                                          image_name() so
#                                                          naming can't drift
#                                                          from what actually
#                                                          gets built. A
#                                                          project whose
#                                                          config can't be
#                                                          parsed, has no
#                                                          ci.ghcrOrg, or
#                                                          declares no
#                                                          services is skipped
#                                                          with a warning on
#                                                          stderr — never
#                                                          silently treated as
#                                                          "nothing to keep".
#                                                          See sprint 331.
#
# Fixture-tested (no live API calls) in ghcr-prune.test.sh.

[[ -n "${_GHCRPRUNE_LIB_LOADED:-}" ]] && return 0
_GHCRPRUNE_LIB_LOADED=1

_GHCRPRUNE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_GHCRPRUNE_LIB_DIR/docker-build.sh"

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

# Sprint 330.1: the gh token driving this script has write:packages but not
# delete:packages, so every real DELETE returns 403. Refuse to start a
# non-dry-run before issuing any DELETE, rather than let hundreds of them
# fail identically and get silently discarded (the defect this sprint fixes).
_ghcrprune_has_delete_scope() {
  [[ "$1" == *"delete:packages"* ]]
}

# Issues one live DELETE. Kept as its own function (rather than inlined in
# the loop below) so ghcr-prune.test.sh can override it with a fake — the
# same pattern other *.test.sh files in this dir use for external commands —
# without this file ever making a real `gh api` call.
_ghcrprune_delete_one() {
  local base="$1" encoded="$2" id="$3"
  local err
  if err=$(gh api --method DELETE "$base/packages/container/$encoded/versions/$id" --silent 2>&1); then
    return 0
  fi
  [[ "$err" == *"HTTP 403"* ]] && return 2
  return 1
}

# Deletes every id via _ghcrprune_delete_one, counting successes and
# failures separately — a failed DELETE is never counted as pruned. Stops at
# the first auth/scope failure (rc 2) instead of repeating the same failure
# for every remaining id: echoes "<deleted> <failed> 1" and returns
# immediately. On exhausting all ids without an auth failure, echoes
# "<deleted> <failed> 0".
_ghcrprune_delete_ids() {
  local base="$1" encoded="$2"; shift 2
  local deleted=0 failed=0 id rc
  for id in "$@"; do
    _ghcrprune_delete_one "$base" "$encoded" "$id"
    rc=$?
    if [[ $rc -eq 0 ]]; then
      deleted=$((deleted + 1))
    elif [[ $rc -eq 2 ]]; then
      failed=$((failed + 1))
      echo "$deleted $failed 1"
      return 0
    else
      failed=$((failed + 1))
    fi
  done
  echo "$deleted $failed 0"
}

# Reads one project's .emit-infra.json and echoes four lines: ghcrOrg,
# ghcrRepo (falling back to the last path segment of github.repo, the same
# rule scripts/lib/pre-push-config.sh:34 applies), imagePrefix, and a
# comma-joined list of blueGreen.services[].name. Build variants
# (ci.buildVariants) are intentionally not read here — a variant is a tag
# suffix on an existing service's image, not a separate package (sprint 331).
# Returns 2 if the file isn't valid JSON.
_ghcrprune_parse_project_config() {
  local config="$1"
  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(2)
ci = d.get("ci", {})
gh = d.get("github", {})
bg = d.get("blueGreen", {})
ghcr_org = ci.get("ghcrOrg") or ""
repo = gh.get("repo") or ""
ghcr_repo = ci.get("ghcrRepo") or (repo.split("/")[-1] if repo else "")
image_prefix = ci.get("imagePrefix") or ""
services = [s.get("name", "") for s in bg.get("services", []) if s.get("name")]
print(ghcr_org)
print(ghcr_repo)
print(image_prefix)
print(",".join(services))
' "$config"
}

# Walks $1/*/.emit-infra.json and echoes "<owner>\t<package>" for every
# declared service, deriving the package path from image_name() (sourced
# above) rather than restating its ghcrOrg/ghcrRepo/imagePrefix rule — see
# the doc comment at the top of this file.
_ghcrprune_discover_packages() {
  local projects_dir="$1" config project parsed
  local ghcr_org ghcr_repo image_prefix services_csv
  local -a svc_array
  local svc full pkg
  for config in "$projects_dir"/*/.emit-infra.json; do
    [[ -f "$config" ]] || continue
    project="$(basename "$(dirname "$config")")"

    if ! parsed=$(_ghcrprune_parse_project_config "$config" 2>/dev/null); then
      echo "ghcr-prune: $project: .emit-infra.json could not be parsed — skipping discovery for this project" >&2
      continue
    fi

    { read -r ghcr_org; read -r ghcr_repo; read -r image_prefix; read -r services_csv; } <<< "$parsed"

    if [[ -z "$ghcr_org" ]]; then
      echo "ghcr-prune: $project: no ci.ghcrOrg configured — skipping discovery for this project" >&2
      continue
    fi
    if [[ -z "$services_csv" ]]; then
      echo "ghcr-prune: $project: no blueGreen.services declared — skipping discovery for this project" >&2
      continue
    fi

    IFS=',' read -r -a svc_array <<< "$services_csv"
    for svc in "${svc_array[@]}"; do
      [[ -z "$svc" ]] && continue
      full=$(GHCR_ORG="$ghcr_org" GHCR_REPO="$ghcr_repo" IMAGE_PREFIX="$image_prefix" image_name "$svc")
      pkg="${full#ghcr.io/$ghcr_org/}"
      printf '%s\t%s\n' "$ghcr_org" "$pkg"
    done
  done
}
