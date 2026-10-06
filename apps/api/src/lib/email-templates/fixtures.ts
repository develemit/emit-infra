import { renderHealthEmail, type HealthEmailInput } from './health.js'
import { renderAlertRuleEmail, type AlertRuleEmailInput } from './alert-rule.js'
import { renderDeployFailedEmail, type DeployFailedEmailInput } from './deploy.js'
import { renderDigestEmail, type DigestEmailInput } from './digest.js'
import type { RenderedEmail } from './types.js'

const NOW = Date.UTC(2026, 9, 6, 16, 0, 0)
const MIN = 60_000

export const healthDown: HealthEmailInput = {
  kind: 'down',
  check: 'http',
  project: 'tastease',
  serverIp: '203.0.113.10',
  url: 'https://tastease.example.com/health',
  status: 502,
  downSinceMs: NOW - 4 * MIN,
  durationMs: 4 * MIN,
  lastGoodMs: NOW - 7 * MIN,
  incidents7d: [
    { atMs: NOW - 3 * 86_400_000, durationMs: 22 * MIN, cause: 'bad gateway' },
    { atMs: NOW - 5 * 86_400_000, durationMs: 6 * MIN, cause: 'SSH unreachable' },
  ],
  nowMs: NOW,
}

export const healthRecovered: HealthEmailInput = { ...healthDown, kind: 'up', durationMs: 14 * MIN, downSinceMs: NOW - 14 * MIN }

export const alertRule: AlertRuleEmailInput = {
  project: 'diner-decider',
  serverIp: '203.0.113.20',
  nowMs: NOW,
  rules: [
    {
      metric: 'diskPct', op: 'gt', threshold: 85, value: 91,
      trend: { current: 91, pctPerDay: 1.5, projectedDaysUntilFull: 6 },
    },
    {
      metric: 'certDays', op: 'lt', threshold: 21, value: 6,
      certName: 'diner-decider.example.com', certDaysLeft: 6, certError: 'Could not bind TCP port 80 because it is already in use',
    },
    { metric: 'backupAgeHours', op: 'gt', threshold: 36, value: 52, backupLastRunMs: NOW - 52 * 60 * MIN, backupStatus: 'failed' },
  ],
}

export const deployFailed: DeployFailedEmailInput = {
  project: 'martialops',
  sha: 'a1b2c3d4e5f6',
  branch: 'main',
  buildNumber: 812,
  durationSec: 187,
  error: 'docker build failed\n#14 ERROR: process "/bin/sh -c pnpm build" did not complete successfully: exit code: 1\nerror TS2322: Type \'string\' is not assignable to type \'number\'.',
  nowMs: NOW,
}

export const digest: DigestEmailInput = {
  summaryLine: '2 incidents, 9 deploys, tastease disk +6%',
  nowMs: NOW,
  projects: [
    { project: 'tastease', status: 'up', incidents: 2, deploys: 4, diskPct: 82, diskDeltaPct: 6, certDays: 40, backupAgeHours: 9 },
    { project: 'martialops', status: 'up', incidents: 0, deploys: 3, diskPct: 44, diskDeltaPct: 0, certDays: 14, backupAgeHours: 20 },
    { project: 'diner-decider', status: 'down', incidents: 0, deploys: 2, diskPct: 93, diskDeltaPct: 1, certDays: 5, backupAgeHours: 80 },
  ],
}

export type SampleKind = 'health' | 'alert-rule' | 'deploy' | 'digest'
export const SAMPLE_KINDS: SampleKind[] = ['health', 'alert-rule', 'deploy', 'digest']

export function renderSample(kind: SampleKind): RenderedEmail {
  switch (kind) {
    case 'health': return renderHealthEmail(healthDown)
    case 'alert-rule': return renderAlertRuleEmail(alertRule)
    case 'deploy': return renderDeployFailedEmail(deployFailed)
    case 'digest': return renderDigestEmail(digest)
  }
}
