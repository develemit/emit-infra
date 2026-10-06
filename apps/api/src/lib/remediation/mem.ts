import { sshCmd } from './shared.js'
import type { FindingOf, Remediation } from './types.js'

export function remediateMem(f: FindingOf<'mem'>): Remediation {
  const pct = Math.round(f.pct)
  if (f.pct < 80) return { urgency: 'none', headline: `Memory at ${pct}% is healthy`, steps: [] }
  return {
    urgency: f.pct >= 90 ? 'now' : 'soon',
    headline: `Memory at ${pct}%`,
    steps: [
      { text: 'Find the top memory consumers.', command: sshCmd(f.serverIp, 'docker stats --no-stream') },
      { text: 'Compare when memory started climbing with the most recent deploy time; a steady climb after a deploy is usually a leak in that build.' },
      { text: 'If one container dominates, restart it, and roll back if the climb resumes.', command: `emit-infra rollback ${f.project}` },
    ],
  }
}
