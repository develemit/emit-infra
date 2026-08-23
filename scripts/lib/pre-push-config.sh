# pre-push-config.sh — reads .emit-infra.json into the pre-push hook's shell
# scope and resolves the deploy-ignore-paths list.
#
# load_pre_push_config <config_file>
#   Sets PROJECT_NAME, CI_TARGETS, ENV_FILE, GHCR_ORG, GHCR_REPO,
#   IMAGE_PREFIX, SSH_KEY, BG_SERVICES, BUILD_ARGS_JSON, BUILD_TARGETS_JSON,
#   BUILD_VARIANTS_JSON, PRE_DEPLOY_JSON, BUILD_TRIGGER_PATHS, BUILD_CACHE,
#   and the DEPLOY_IGNORE_PATHS array in the caller's scope (called without a
#   subshell, same as the inline block it replaces). Depends on
#   EMIT_DEFAULT_DEPLOY_IGNORE_PATHS already being in scope — sourced via
#   deploy-path-filter.sh / deploy-plan.sh, which pre-push sources first.

[[ -n "${_EMIT_PRE_PUSH_CONFIG_LOADED:-}" ]] && return 0
_EMIT_PRE_PUSH_CONFIG_LOADED=1

load_pre_push_config() {
  local config_file="$1"

  eval "$(python3 -c "
import json, shlex
c = json.load(open('$config_file'))
ci = c.get('ci', {})
bg = c.get('blueGreen', {})
gh = c.get('github', {})

def out(name, val):
    print(f'{name}={shlex.quote(str(val))}')

out('PROJECT_NAME', c.get('name', ''))
out('CI_TARGETS', ' '.join(ci.get('prePush', ['lint', 'typecheck', 'test', 'build'])))
out('ENV_FILE', ci.get('envFile', ''))
out('GHCR_ORG', ci.get('ghcrOrg', ''))
out('GHCR_REPO', ci.get('ghcrRepo', gh.get('repo', '').split('/')[-1]))
out('IMAGE_PREFIX', ci.get('imagePrefix', ''))
out('SSH_KEY', ci.get('sshKey', '~/.ssh/emit-deploy'))
out('BG_SERVICES', ' '.join(s['name'] for s in bg.get('services', [])))
out('BUILD_ARGS_JSON', json.dumps(ci.get('buildArgs', {})))
out('BUILD_TARGETS_JSON', json.dumps(ci.get('buildTargets', {})))
out('BUILD_VARIANTS_JSON', json.dumps(ci.get('buildVariants', {})))
out('PRE_DEPLOY_JSON', json.dumps(ci.get('preDeploy', [])))
out('DEPLOY_IGNORE_PATHS_OVERRIDE', ' '.join(ci.get('deployIgnorePaths', [])))
out('DEPLOY_IGNORE_PATHS_EXTRA', ' '.join(ci.get('deployIgnorePathsExtra', [])))
out('BUILD_TRIGGER_PATHS', ' '.join(ci.get('buildTriggerPaths', [])))
out('BUILD_CACHE', ci.get('buildCache', 'inline'))
")"

  # ci.deployIgnorePaths replaces the built-in defaults; deployIgnorePathsExtra
  # appends to them. See docs/DEPLOY-GATES.md#ignored-paths.
  if [[ -n "$DEPLOY_IGNORE_PATHS_OVERRIDE" ]]; then
    IFS=' ' read -r -a DEPLOY_IGNORE_PATHS <<< "$DEPLOY_IGNORE_PATHS_OVERRIDE"
  else
    DEPLOY_IGNORE_PATHS=("${EMIT_DEFAULT_DEPLOY_IGNORE_PATHS[@]}")
  fi
  for _p in $DEPLOY_IGNORE_PATHS_EXTRA; do DEPLOY_IGNORE_PATHS+=("$_p"); done
}
