/**
 * Background SSH + HTTP reachability monitor.
 *
 * Polls every 60 s and fires a Web Push notification once an outage is
 * confirmed (debounced — see lib/http-health.ts), with reminders while it
 * stays down and a notification on recovery. Also evaluates per-project
 * alertRules each cycle and persists fired alerts to .alerts.jsonl when
 * thresholds are breached.
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sshExec } from '@emit-infra/core'
import { discoverProjects } from './discover-projects.js'
import { sshKeyPath } from './project-helpers.js'
import { sendToAll, type PushPayload } from './push.js'
import { evaluateRules, resolveRules, type AlertMetrics, type AlertCooldownState, type FiredAlert } from './alert-rules.js'
import { pruneAlertJsonl } from './prune-alerts.js'
import {
  CERT_PROBE_CMD, extractCertSection, extractCertbotSection, probeBlockEndIndex,
  parseCertLines, parseCertbotSection, soonestExpiring, classifyRenewalHealth,
} from './cert-probe.js'
import { stepHealth, initialHealthState, type HealthState, type ProbeResult } from './http-health.js'
import { handleHealthEvents, seedHealthMaps } from './health-notify.js'

const metricLabels: Record<string, string> = {
  diskPct: 'disk', memPct: 'memory', certDays: 'cert days', backupAgeHours: 'backup age (h)',
}

/** certDays/certStatus/certRenewalFailing alerts get a human-readable detail
 *  instead of the generic "metric value op threshold" line — certbot's
 *  30-day renewal window is the whole point of the notification. */
export function enrichFiredAlert(alert: FiredAlert, metrics: AlertMetrics): FiredAlert {
  if (alert.metric === 'certDays' && metrics.certName) {
    return {
      ...alert,
      detail: `${metrics.certName}: ${Math.round(alert.value)}d left — certbot should have renewed it ` +
        `at 30 days, so renewal is failing on this server.`,
    }
  }
  if (alert.metric === 'certStatus') {
    return { ...alert, detail: 'No readable certificate found on this server — check certbot.' }
  }
  if (alert.metric === 'certRenewalFailing') {
    const err = metrics.certbotError ?? 'no error line found in the certbot journal'
    return { ...alert, detail: `certbot renewal is failing: ${err}` }
  }
  return alert
}

function describeAlert(alert: FiredAlert): string {
  if (alert.detail) return alert.detail
  const label = metricLabels[alert.metric] ?? alert.metric
  const opLabel = alert.op === 'gt' ? '>' : '<'
  return `${label} ${Math.round(alert.value)} ${opLabel} ${alert.threshold}`
}

export function formatAlertNotification(fired: FiredAlert[]): PushPayload {
  const name = fired[0]!.projectName
  const url = `/projects/${encodeURIComponent(name)}/reliability`

  if (fired.length === 1) {
    const alert = fired[0]!
    return {
      title: name,
      body: describeAlert(alert),
      url,
      tag: `alert:${name}:${alert.metric}`,
    }
  }

  const parts = fired.map(describeAlert)
  return {
    title: name,
    body: `${fired.length} alerts: ${parts.join(', ')}`,
    url,
    tag: `alert:${name}:bundle`,
  }
}

const POLL_MS = 60_000
let sshHealth = new Map<string, HealthState>()
let httpHealth = new Map<string, HealthState>()
const httpCircuit = new Map<string, { failures: number; skipUntil: number }>()

async function probeProject(
  host: string,
  key: string,
  name: string,
): Promise<{ state: 'up' | 'down'; metrics?: AlertMetrics }> {
  try {
    const raw = await sshExec(
      host,
      `df -h / | tail -1 | awk '{print $5}' | tr -d '%'; ` +
        `free -m | awk 'NR==2{printf "%.0f\\n",$3/$2*100}'; ` +
        `${CERT_PROBE_CMD}; ` +
        `grep -o '"lastRun":"[^"]*"' /opt/${name}/.backup-status.json 2>/dev/null | cut -d'"' -f4; echo ""`,
      key,
    )
    const lines = raw.split('\n').map(l => l.trim())
    const metrics: AlertMetrics = {}

    const disk = parseInt(lines[0] ?? '', 10)
    if (!isNaN(disk)) metrics.diskPct = disk

    const mem = parseInt(lines[1] ?? '', 10)
    if (!isNaN(mem)) metrics.memPct = mem

    const certs = parseCertLines(extractCertSection(lines))
    const soonest = soonestExpiring(certs)
    if (soonest) {
      metrics.certDays = soonest.daysRemaining
      metrics.certName = soonest.name
    } else {
      metrics.certStatus = 1
    }

    const certbotStatus = parseCertbotSection(extractCertbotSection(lines))
    const renewalHealth = classifyRenewalHealth(certbotStatus, certs)
    if (renewalHealth === 'failing') {
      metrics.certRenewalFailing = 1
      metrics.certbotError = certbotStatus.errorLine ?? undefined
    }

    const endIdx = probeBlockEndIndex(lines)
    const backupLastRun = endIdx === -1 ? '' : (lines[endIdx + 1] ?? '')
    if (backupLastRun) {
      const lastRunMs = new Date(backupLastRun).getTime()
      if (!isNaN(lastRunMs)) {
        metrics.backupAgeHours = (Date.now() - lastRunMs) / 3600000
      }
    }

    return { state: 'up', metrics }
  } catch {
    return { state: 'down' }
  }
}

function recordHttpFailure(url: string): void {
  const entry = httpCircuit.get(url) ?? { failures: 0, skipUntil: 0 }
  entry.failures += 1
  if (entry.failures >= 3) {
    entry.skipUntil = Date.now() + 5 * POLL_MS
    entry.failures = 0
  }
  httpCircuit.set(url, entry)
}

async function httpProbe(url: string): Promise<ProbeResult> {
  const circuit = httpCircuit.get(url)
  if (circuit && Date.now() < circuit.skipUntil) {
    return { ok: false }
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      httpCircuit.delete(url)
      return { ok: true, status: res.status }
    }
    recordHttpFailure(url)
    return { ok: false, status: res.status }
  } catch {
    recordHttpFailure(url)
    return { ok: false }
  }
}

async function readAlertState(name: string): Promise<AlertCooldownState> {
  try {
    const path = join(homedir(), 'projects', name, '.alert-state.json')
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as AlertCooldownState
  } catch {
    return {}
  }
}

async function persistAlerts(name: string, fired: FiredAlert[], newState: AlertCooldownState): Promise<void> {
  const dir = join(homedir(), 'projects', name)
  await writeFile(join(dir, '.alert-state.json'), JSON.stringify(newState)).catch(
    err => console.error('[status-monitor] writeAlertState failed:', err),
  )
  for (const alert of fired) {
    await appendFile(join(dir, '.alerts.jsonl'), JSON.stringify(alert) + '\n').catch(
      err => console.error('[status-monitor] appendAlert failed:', err),
    )
  }
  if (fired.length > 0) {
    await pruneAlertJsonl(join(dir, '.alerts.jsonl')).catch(
      err => console.error('[status-monitor] pruneAlerts failed:', err),
    )
  }
}

async function poll(): Promise<void> {
  const projects = await discoverProjects().catch(() => [])
  const now = Date.now()

  await Promise.allSettled(
    projects.map(async ({ config }) => {
      const host = config.serverIp ?? config.domain
      const key = sshKeyPath(config.sshKeyName)
      const { state: sshNext, metrics } = await probeProject(host, key, config.name)

      const sshResult: ProbeResult = { ok: sshNext === 'up' }
      const sshStep = stepHealth(sshHealth.get(config.name) ?? initialHealthState, sshResult, now)
      sshHealth.set(config.name, sshStep.state)
      await handleHealthEvents('ssh', config.name, sshStep.events)

      if (config.healthCheck?.url) {
        const httpResult = await httpProbe(config.healthCheck.url)
        const httpStep = stepHealth(httpHealth.get(config.name) ?? initialHealthState, httpResult, now)
        httpHealth.set(config.name, httpStep.state)
        await handleHealthEvents('http', config.name, httpStep.events)
      }

      if (metrics !== undefined) {
        const rules = resolveRules(config.alertRules ?? [])
        const prevState = await readAlertState(config.name)
        const { fired, newState } = evaluateRules(config.name, rules, metrics, prevState)
        const enrichedFired = fired.map(alert => enrichFiredAlert(alert, metrics))
        await persistAlerts(config.name, enrichedFired, newState)
        if (enrichedFired.length > 0) {
          await sendToAll(formatAlertNotification(enrichedFired)).catch(() => {/* best-effort */})
        }
      }
    }),
  )
}

export function startStatusMonitor(): void {
  // Delay first poll by 10 s to let the server finish booting.
  setTimeout(() => {
    void (async () => {
      // Seed from the last recorded incident so a monitor restart mid-outage
      // still sends reminders and a recovery notification instead of
      // forgetting the outage was ever happening.
      const seeded = await seedHealthMaps()
      sshHealth = seeded.ssh
      httpHealth = seeded.http
      await poll()
      setInterval(() => void poll(), POLL_MS)
    })()
  }, 10_000)
}
