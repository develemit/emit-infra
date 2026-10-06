import type { FindingOf, Remediation, Step } from './types.js'

const POST_SWITCH = /health.?check|unhealthy|post-deploy|after (the )?switch|switch(ed)? (traffic|slot)|did not become healthy/i
const TRANSIENT = /TLS handshake|ECONNRESET|ETIMEDOUT|i\/o timeout|toomanyrequests|temporary failure|503 service unavailable|failed to (pull|push)|ghcr\.io.*(denied|timeout|unavailable)/i
const BUILD = /docker build failed|\bTS\d{4}\b|ERR_PNPM|exit code|ELIFECYCLE|npm ERR!/i

export type DeployFailureClass = 'post-switch' | 'transient' | 'build' | 'unknown'

export function classifyDeployError(error: string): DeployFailureClass {
  if (POST_SWITCH.test(error)) return 'post-switch'
  if (TRANSIENT.test(error)) return 'transient'
  if (BUILD.test(error)) return 'build'
  return 'unknown'
}

function logStep(f: FindingOf<'deploy-failed'>): Step {
  const sha = f.sha && f.sha !== 'unknown' ? f.sha.slice(0, 7) : undefined
  const file = sha ? `/tmp/emit-deploy-${f.project}-${sha}.log` : `"$(ls -t /tmp/emit-deploy-${f.project}-*.log | head -1)"`
  return { text: 'Read the full deploy log.', command: `tail -n 100 ${file}` }
}

export function remediateDeployFailed(f: FindingOf<'deploy-failed'>): Remediation {
  switch (classifyDeployError(f.error)) {
    case 'post-switch':
      return {
        urgency: 'now',
        headline: 'Failed after traffic may have switched',
        steps: [
          { text: 'Production may be serving the new broken build. Roll back first, investigate second.', command: `emit-infra rollback ${f.project}` },
          logStep(f),
          { text: 'Fix the cause locally, then push again.', command: `cd ~/projects/${f.project} && pnpm typecheck && pnpm build` },
        ],
      }
    case 'transient':
      return {
        urgency: 'soon',
        headline: 'Registry or network error during deploy',
        steps: [
          { text: 'The previous build is still serving, no rollback needed. Re-push; the build retries once automatically.', command: `cd ~/projects/${f.project} && git push origin main` },
          logStep(f),
        ],
      }
    case 'build':
      return {
        urgency: 'soon',
        headline: 'Build failed before the switch',
        steps: [
          { text: 'Production is unaffected: the failure was at build time, so no rollback needed. Fix the error locally and push again.', command: `cd ~/projects/${f.project} && pnpm typecheck && pnpm build` },
          logStep(f),
        ],
      }
    default:
      return {
        urgency: 'soon',
        headline: 'Deploy failed for an unrecognised reason',
        steps: [
          logStep(f),
          { text: 'Confirm what is serving before deciding on a rollback.', command: `emit-infra status ${f.project}` },
          { text: 'Roll back only if production is unhealthy.', command: `emit-infra rollback ${f.project}` },
        ],
      }
  }
}
