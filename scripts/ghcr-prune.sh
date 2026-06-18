#!/usr/bin/env bash
# ghcr-prune.sh — prune old GHCR container image versions
# Keeps the N most recent versioned tags per image. :latest is always preserved.
# Usage: ./scripts/ghcr-prune.sh [--keep N] [--dry-run]
set -euo pipefail

KEEP=10
DRY_RUN=false
GHCR_OWNER="develemit"

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

  ids=$(gh api "$BASE/packages/container/$encoded/versions" \
    --paginate --jq "
      sort_by(.created_at) | reverse |
      [ .[] | select(.metadata.container.tags | index(\"latest\") | not) ] |
      .[$KEEP:] | .[].id
    " 2>/dev/null || true)

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
  echo "✓ dry run complete — would prune $total_pruned versions (kept $KEEP most recent per image)"
else
  echo "✓ pruned $total_pruned versions (kept $KEEP most recent per image)"
fi
