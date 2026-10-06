import { formatDuration } from '../http-health.js'
import { remediate } from '../remediation/index.js'
import { classifyDeployError } from '../remediation/deploy.js'
import { firstStepOf, renderWhatToDo } from './what-to-do.js'
import { renderLayout } from './layout.js'
import { dashboardUrl, formatTime } from './format.js'
import type { RenderedEmail } from './types.js'

export interface DeployFailedEmailInput {
  project: string
  sha: string
  branch: string
  buildNumber: number
  durationSec: number
  error: string
  nowMs: number
}

export function renderDeployFailedEmail(i: DeployFailedEmailInput): RenderedEmail {
  const sha = i.sha.slice(0, 7)
  const rem = remediate({ kind: 'deploy-failed', project: i.project, sha: i.sha, error: i.error })
  const servingNote =
    classifyDeployError(i.error) === 'post-switch'
      ? 'Production may be serving the new build.'
      : 'The previous build should still be serving.'
  const duration = formatDuration(i.durationSec * 1000)
  const { html, text } = renderLayout({
    tone: 'critical',
    preheader: `${i.project} #${i.buildNumber} (${sha}) failed after ${duration}`,
    headline: `${i.project} deploy #${i.buildNumber} failed`,
    summary: `The deploy of ${sha} on ${i.branch} failed after ${duration}. ${servingNote}`,
    facts: [
      ['Project', i.project],
      ['Commit', sha],
      ['Branch', i.branch],
      ['Build number', `#${i.buildNumber}`],
      ['Duration', duration],
      ['Failed at', formatTime(i.nowMs, i.nowMs)],
    ],
    sections: [renderWhatToDo(rem), { title: 'Error output', kind: 'pre', text: i.error }],
    actions: {
      buttons: [{ label: 'Open in dashboard', url: dashboardUrl(`/projects/${encodeURIComponent(i.project)}`) }],
    },
    footerNote: 'Sent because a deploy failed.',
    sentAtMs: i.nowMs,
  })
  return { subject: `[emit-infra] 🔴 ${i.project} deploy #${i.buildNumber} failed`, html, text, tone: 'critical', ...firstStepOf([rem]) }
}
