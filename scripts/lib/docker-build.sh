# docker-build.sh — image naming and buildx invocation for the pre-push deploy.
#
# Reads the config the hook already exported: GHCR_ORG, GHCR_REPO, IMAGE_PREFIX,
# BUILD_ARGS_JSON, BUILD_TARGETS_JSON, BUILD_VARIANTS_JSON, BUILD_CACHE,
# SHA, BUILD_NUMBER.

[[ -n "${_EMIT_DOCKER_BUILD_LOADED:-}" ]] && return 0
_EMIT_DOCKER_BUILD_LOADED=1

image_name() {
  local svc="$1"
  if [[ -n "$IMAGE_PREFIX" ]]; then
    echo "ghcr.io/$GHCR_ORG/${IMAGE_PREFIX}${svc}"
  elif [[ -n "$GHCR_REPO" ]]; then
    echo "ghcr.io/$GHCR_ORG/$GHCR_REPO/$svc"
  else
    echo "ghcr.io/$GHCR_ORG/$svc"
  fi
}

get_build_args() {
  local svc="$1"
  python3 -c "
import json, os
args = json.loads('$BUILD_ARGS_JSON')
for a in args.get('$svc', []):
    val = os.environ.get(a['env'], '')
    print(f'--build-arg {a[\"name\"]}={val}')
" 2>/dev/null || true
}

# Extra Dockerfile targets built alongside the main image.
get_build_variants() {
  local svc="$1"
  python3 -c "
import json
variants = json.loads('$BUILD_VARIANTS_JSON')
for v in variants.get('$svc', []):
    print(f'{v[\"target\"]} {v[\"tagSuffix\"]}')
" 2>/dev/null || true
}

get_build_target() {
  local svc="$1"
  python3 -c "
import json
targets = json.loads('$BUILD_TARGETS_JSON')
print(targets.get('$svc', ''))
" 2>/dev/null || true
}

# Registry-backed layer cache so a cold rebuild reuses the last pushed image.
# 'inline' embeds cache metadata in the image itself — no extra tag, so
# scripts/ghcr-prune.sh (which keeps only :latest + versioned tags) can't
# delete the cache out from under us. 'off' disables it. Set via ci.buildCache.
cache_flags() {
  local ref="$1"
  [[ "${BUILD_CACHE:-inline}" == "off" ]] && return 0
  printf -- '--cache-from type=registry,ref=%s --cache-to type=inline' "$ref"
}

build_image() {
  local svc="$1"
  local img
  img=$(image_name "$svc")
  local extra_args
  extra_args=$(get_build_args "$svc")
  local target target_flag=""
  target=$(get_build_target "$svc")
  [[ -n "$target" ]] && target_flag="--target $target"
  local cache
  cache=$(cache_flags "$img:latest")

  echo "==> Building $svc..."
  # shellcheck disable=SC2086
  docker buildx build \
    --platform linux/amd64 \
    -f "apps/$svc/Dockerfile" \
    $target_flag \
    --build-arg BUILD_NUMBER="$BUILD_NUMBER" \
    $extra_args \
    $cache \
    -t "$img:$SHA" \
    -t "$img:$BUILD_NUMBER" \
    -t "$img:latest" \
    --push \
    --quiet \
    .

  get_build_variants "$svc" | while read -r target suffix; do
    [[ -z "$target" ]] && continue
    echo "==> Building $svc variant '$target' (tag suffix $suffix)..."
    cache=$(cache_flags "$img:latest${suffix}")
    # shellcheck disable=SC2086
    docker buildx build \
      --platform linux/amd64 \
      -f "apps/$svc/Dockerfile" \
      --target "$target" \
      --build-arg BUILD_NUMBER="$BUILD_NUMBER" \
      $extra_args \
      $cache \
      -t "$img:${BUILD_NUMBER}${suffix}" \
      -t "$img:latest${suffix}" \
      --push \
      --quiet \
      .
  done
}

retag_image() {
  local svc="$1"
  local img
  img=$(image_name "$svc")
  echo "==> Re-tagging $svc:latest as :$SHA / :$BUILD_NUMBER..."
  docker buildx imagetools create -t "$img:$SHA" -t "$img:$BUILD_NUMBER" "$img:latest"
  get_build_variants "$svc" | while read -r target suffix; do
    [[ -z "$target" ]] && continue
    echo "==> Re-tagging $svc variant latest${suffix} as :${BUILD_NUMBER}${suffix}..."
    docker buildx imagetools create -t "$img:${BUILD_NUMBER}${suffix}" "$img:latest${suffix}"
  done
}
