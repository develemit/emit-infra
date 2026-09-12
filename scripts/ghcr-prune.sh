#!/usr/bin/env bash
# ghcr-prune.sh — prune old GHCR container image versions
# Keeps the N most recent tagged (release) versions per image. Any tag equal
# to "latest" or starting "latest-" (e.g. "latest-migrate") and the version
# currently running on any fleet server (matched by sha against every
# ~/projects/*/.deploy-status.json) are always preserved. Untagged versions
# (attestations, provenance, and platform manifests referenced by a tagged
# manifest list) are never counted toward the keep budget and never deleted —
# there is no reliable way from this API alone to tell an orphaned untagged
# manifest from one still referenced by a retained tag. See sprint 330.
# Usage: ./scripts/ghcr-prune.sh [--keep N] [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghcr-prune-lib.sh"

KEEP=10
DRY_RUN=false
GHCR_OWNER="develemit"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "usage: ghcr-prune.sh [--keep N] [--dry-run]" >&2; exit 1 ;;
  esac
done

PACKAGES=(
  develemail-web develemail-api develemail-worker
  "easyliving/api" "easyliving/web" "easyliving/marketing"
  emit-api emit-worker emit-web emit-marketing
)

# Fail safe: an unparseable status file means we can no longer trust what's
# running, and an empty result means we found nothing to protect at all —
# either way, proceeding would risk deleting a live release (sprint 330).
deployed_shas=""
if ! deployed_shas=$(_ghcrprune_collect_deployed_shas "$PROJECTS_DIR"); then
  echo "✗ could not determine deployed releases under $PROJECTS_DIR — refusing to prune anything" >&2
  exit 1
fi
if [[ -z "$deployed_shas" ]]; then
  echo "✗ no deployed releases found under $PROJECTS_DIR — refusing to prune anything (empty protection set)" >&2
  exit 1
fi

# readarray/mapfile need bash 4+; the launchd job's PATH resolves
# /usr/bin/env bash to macOS's stock bash 3.2, so build the array by hand.
PROTECTED_SHAS=()
while IFS= read -r sha; do
  [[ -n "$sha" ]] && PROTECTED_SHAS+=("$sha")
done <<< "$deployed_shas"
echo "protecting ${#PROTECTED_SHAS[@]} currently-deployed release(s)"

# Determine API base (org vs user)
if gh api "/orgs/$GHCR_OWNER" --silent 2>/dev/null; then
  BASE="orgs/$GHCR_OWNER"
else
  BASE="users/$GHCR_OWNER"
fi

total_pruned=0

for pkg in "${PACKAGES[@]}"; do
  encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$pkg")

  echo "→ $pkg"

  # --paginate applies --jq per page rather than to one combined array, so
  # '.[]' (one JSON object per line, across every page) is what's safe to feed
  # the selector — not '.' , which would emit one array per page.
  versions_jsonl=$(gh api "$BASE/packages/container/$encoded/versions" --paginate --jq '.[]' 2>/dev/null || true)

  ids=$(echo "$versions_jsonl" | _ghcrprune_select_prune_ids "$KEEP" "${PROTECTED_SHAS[@]}")

  if [[ -z "$ids" ]]; then
    echo "  nothing to prune"
    continue
  fi

  count=$(echo "$ids" | wc -l | tr -d ' ')

  if $DRY_RUN; then
    echo "  would prune $count versions (dry run)"
  else
    echo "  pruning $count versions"
    while IFS= read -r id; do
      gh api --method DELETE "$BASE/packages/container/$encoded/versions/$id" --silent 2>/dev/null || true
    done <<< "$ids"
  fi

  total_pruned=$((total_pruned + count))
done

if $DRY_RUN; then
  echo "✓ dry run complete — would prune $total_pruned versions (kept $KEEP most recent tagged releases per image)"
else
  echo "✓ pruned $total_pruned versions (kept $KEEP most recent tagged releases per image)"
fi
