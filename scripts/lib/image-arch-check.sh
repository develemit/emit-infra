# image-arch-check.sh — loads native modules inside just-built images on the
# target platform, so a build that succeeds on the arm64 build host but ships
# the wrong platform's compiled binary (tastease build 1247: arm64-only
# esbuild/sharp on an x64 server) is caught before deploy, not after.
#
# "Is the package present?" is not a valid check here: pnpm leaves a dangling
# symlink for a platform it never fetched — the .pnpm slot and the link into
# it both exist, but the package directory they point at does not. `ls
# node_modules/.pnpm | grep linux-x64` passes on a broken image. Every probe
# below loads the module instead.
#
# Reads IMAGE_ARCH_PROBES_JSON (set by pre-push-config.sh from
# ci.imageArchProbes) and BUILD_NUMBER (exported by the pre-push hook).
# Depends on image_name() from docker-build.sh.
#
#   run_image_arch_checks <built-service>...   -> 0 if every declared probe
#     for the given services loads cleanly, 1 (with a message naming the
#     image/probe/error) otherwise. No-ops — zero docker commands — when no
#     given service declares any probe.

[[ -n "${_EMIT_IMAGE_ARCH_CHECK_LOADED:-}" ]] && return 0
_EMIT_IMAGE_ARCH_CHECK_LOADED=1

IMAGE_ARCH_PLATFORM="${IMAGE_ARCH_PLATFORM:-linux/amd64}"

# <svc> -> "<kind>\t<variant>" lines, one per declared probe. <variant> is the
# tag suffix from ci.buildVariants (e.g. "-migrate"), empty for the main image.
_image_arch_probes_for() {
  local svc="$1"
  python3 -c "
import json
probes = json.loads('$IMAGE_ARCH_PROBES_JSON')
for p in probes.get('$svc', []):
    print(f\"{p['kind']}\t{p.get('variant', '')}\")
" 2>/dev/null || true
}

image_arch_check_has_any() {
  local svc
  for svc in "$@"; do
    [[ -n "$(_image_arch_probes_for "$svc")" ]] && return 0
  done
  return 1
}

# Named probe kinds. Keep this list small and reviewable — see
# docs/CROSS-PLATFORM-BUILD-PATTERN.md for why each shape is what it is.
_image_arch_probe_cmd() { # <kind> <svc>
  local kind="$1" svc="$2"
  case "$kind" in
    tsx)
      # tsx shells out to esbuild's native binary at transform time, not at
      # container start — so a one-line .ts transform is the real test.
      # Match a sentinel line, not the last line: npx prints an npm update
      # notice after the real output.
      printf '%s' 'printf "const x: number = 1; console.log(\"ok\", x)\n" > /tmp/probe.ts && npx tsx /tmp/probe.ts'
      ;;
    next-sharp)
      # sharp is an optional dependency of next, so it resolves only from
      # next's own package dir — require('sharp') from the app root fails
      # even on a good image. Starting the container proves nothing either:
      # Next only loads sharp lazily, on the first /_next/image request.
      printf '%s' "cd /app/apps/$svc && node -e \"
const {createRequire}=require('module');
const nextPkg=createRequire(process.cwd()+'/').resolve('next/package.json');
console.log('ok', createRequire(nextPkg)('sharp').versions.sharp)\""
      ;;
    *)
      return 1
      ;;
  esac
}

# <ref> -> prints the ref on success. Resolves the local Docker store first
# (the image just built by this same hook run), falling back to a registry
# pull for a validation run against an older release.
_image_arch_resolve_image() {
  local ref="$1"
  if docker image inspect "$ref" >/dev/null 2>&1; then
    echo "$ref"
    return 0
  fi
  docker pull -q --platform "$IMAGE_ARCH_PLATFORM" "$ref" >/dev/null 2>&1 || return 1
  echo "$ref"
}

_image_arch_run_probe() { # <label> <image> <kind> <svc>
  local label="$1" image="$2" kind="$3" svc="$4"
  local cmd
  cmd=$(_image_arch_probe_cmd "$kind" "$svc") || {
    echo "✗ image-arch-check: $label ($image): unknown probe kind '$kind'"
    return 1
  }
  local out
  out=$(docker run --rm --platform "$IMAGE_ARCH_PLATFORM" --entrypoint sh \
    -e NPM_CONFIG_UPDATE_NOTIFIER=false "$image" -c "$cmd" 2>&1 || true)
  if grep -q '^ok' <<<"$out"; then
    echo "✓ image-arch-check: $label ($image) [$kind]: $(grep -m1 '^ok' <<<"$out")"
    return 0
  fi
  local err
  err=$(grep -m1 -E 'needs the|Could not load' <<<"$out" || grep -m1 'Error' <<<"$out" || tail -1 <<<"$out")
  echo "✗ image-arch-check: $label ($image) [$kind probe]: $err"
  return 1
}

run_image_arch_checks() {
  if [[ -z "${IMAGE_ARCH_PROBES_JSON:-}" || "$IMAGE_ARCH_PROBES_JSON" == "{}" ]] \
    || ! image_arch_check_has_any "$@"; then
    echo "→ image-arch-check: no probes declared for built services, skipping"
    return 0
  fi

  local svc kind variant failed=0
  for svc in "$@"; do
    while IFS=$'\t' read -r kind variant; do
      [[ -z "$kind" ]] && continue
      local img="$(image_name "$svc"):${BUILD_NUMBER}${variant}"
      local resolved
      if ! resolved=$(_image_arch_resolve_image "$img"); then
        echo "✗ image-arch-check: could not resolve $img locally or via pull"
        failed=1
        continue
      fi
      local label="$svc"
      [[ -n "$variant" ]] && label="$svc variant $variant"
      _image_arch_run_probe "$label" "$resolved" "$kind" "$svc" || failed=1
    done < <(_image_arch_probes_for "$svc")
  done
  return $failed
}
