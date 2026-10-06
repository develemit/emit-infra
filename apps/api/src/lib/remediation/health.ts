import { sshCmd } from './shared.js'
import type { FindingOf, Remediation, Step } from './types.js'

const logsStep = (): Step => ({
  text: 'Read the recent app logs for errors.',
  command: `emit-infra logs <container> --since 1h --errors`,
})
const psStep = (f: FindingOf<'health'>): Step => ({
  text: 'See which containers are running or crash-looping.',
  command: sshCmd(f.serverIp, `cd /opt/${f.project} && docker compose ps`),
})
const statusStep = (f: FindingOf<'health'>): Step => ({ text: 'Check the fleet view for this project.', command: `emit-infra status ${f.project}` })

const TLS_STATUSES = new Set([525, 526])
const CONTAINER_DOWN = new Set([502, 503, 521])

export function remediateHealth(f: FindingOf<'health'>): Remediation {
  if (f.recovered) {
    const mins = f.durationMs !== undefined ? Math.max(1, Math.round(f.durationMs / 60_000)) : undefined
    return {
      urgency: 'none',
      headline: 'No action needed',
      steps: [{ text: `No action needed. Consider checking what caused the ${mins ?? ''}${mins ? '-minute ' : ''}outage.` }, logsStep()],
    }
  }
  if (f.check === 'ssh') {
    return {
      urgency: 'now',
      headline: 'Server is unreachable over SSH',
      steps: [
        statusStep(f),
        { text: 'Check the server in the Hetzner console; if it is hung or out of memory, reboot it from there.' },
        { text: 'Once SSH is back, check disk and memory before assuming it was a one-off.', command: sshCmd(f.serverIp, 'df -h / && free -m') },
      ],
    }
  }
  if (f.status !== undefined && TLS_STATUSES.has(f.status)) {
    return {
      urgency: 'now',
      headline: 'Origin TLS certificate problem',
      steps: [
        { text: 'The certificate is invalid or expired. Reproduce the renewal failure.', command: sshCmd(f.serverIp, 'certbot renew --dry-run') },
        { text: 'Check the renewal method and fix it, as for the certificate alert.', link: 'docs/DEPLOYMENT-PITFALLS.md' },
      ],
    }
  }
  if (f.status !== undefined && CONTAINER_DOWN.has(f.status)) {
    return {
      urgency: 'now',
      headline: 'Container is down or crash-looping',
      steps: [
        psStep(f),
        logsStep(),
        { text: 'Restart the stack once you know why it stopped.', command: sshCmd(f.serverIp, `cd /opt/${f.project} && docker compose up -d`) },
      ],
    }
  }
  if (f.status !== undefined && f.status >= 500 && f.status !== 504) {
    return {
      urgency: 'now',
      headline: 'App is returning server errors',
      steps: [logsStep(), { text: 'Compare the first error time with the most recent deploy; if it lines up, roll back.', command: `emit-infra rollback ${f.project}` }],
    }
  }
  return {
    urgency: 'now',
    headline: 'Health check is timing out',
    steps: [
      statusStep(f),
      { text: 'The server may be overloaded or unreachable. Check load and memory.', command: sshCmd(f.serverIp, 'uptime && free -m && docker stats --no-stream') },
      psStep(f),
    ],
  }
}
