import type { FindingOf, Remediation } from './types.js'

export function remediateIncidents(f: FindingOf<'incidents'>): Remediation {
  if (f.count === 0) return { urgency: 'none', headline: 'No incidents this week', steps: [] }
  return {
    urgency: f.count >= 3 ? 'soon' : 'watch',
    headline: `${f.count} incident${f.count === 1 ? '' : 's'} this week`,
    steps: [
      { text: 'Review the incident timeline in the dashboard. Repeated short outages usually mean a crash loop or memory pressure.' },
      { text: 'Check recent container logs for restarts.', command: `emit-infra logs <container> --since 24h --errors` },
    ],
  }
}
