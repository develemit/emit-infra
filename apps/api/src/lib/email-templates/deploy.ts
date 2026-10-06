import { formatDuration } from '../http-health.js'
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
  const duration = formatDuration(i.durationSec * 1000)
  const { html, text } = renderLayout({
    tone: 'critical',
    preheader: `${i.project} #${i.buildNumber} (${sha}) failed after ${duration}`,
    headline: `${i.project} deploy #${i.buildNumber} failed`,
    summary: `The deploy of ${sha} on ${i.branch} failed after ${duration}. The previous build should still be serving.`,
    facts: [
      ['Project', i.project],
      ['Commit', sha],
      ['Branch', i.branch],
      ['Build number', `#${i.buildNumber}`],
      ['Duration', duration],
      ['Failed at', formatTime(i.nowMs, i.nowMs)],
    ],
    sections: [{ title: 'Error output', kind: 'pre', text: i.error }],
    actions: {
      buttons: [{ label: 'Open in dashboard', url: dashboardUrl(`/projects/${encodeURIComponent(i.project)}`) }],
      run: [`emit-infra rollback ${i.project}`, `tail -n 100 projects/${i.project}/.deploy-history.jsonl`],
    },
    footerNote: 'Sent because a deploy failed. Deploy history is in .deploy-history.jsonl in the project directory.',
    sentAtMs: i.nowMs,
  })
  return { subject: `[emit-infra] 🔴 ${i.project} deploy #${i.buildNumber} failed`, html, text, tone: 'critical' }
}
