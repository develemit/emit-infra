/**
 * Background SSH reachability monitor.
 *
 * Polls every 60 s and fires a Web Push notification on up→down and down→up
 * transitions. Runs entirely server-side so notifications are delivered even
 * when no browser tab is open.
 */

import { appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sshExec } from '@emit-infra/core'
import { discoverProjects } from './discover-projects.js'
import { sshKeyPath } from './project-helpers.js'
import { sendToAll } from './push.js'

interface IncidentRecord {
  type: 'ssh' | 'http'
  projectName: string
  event: 'down' | 'up'
  t: number
}

function writeIncident(record: IncidentRecord): void {
  const path = join(homedir(), 'projects', record.projectName, '.incidents.jsonl')
  appendFile(path, JSON.stringify(record) + '\n').catch((err) => console.error('[status-monitor] writeIncident failed:', err))
}

const POLL_MS = 60_000
const sshState = new Map<string, 'up' | 'down'>()
const httpState = new Map<string, 'up' | 'down'>()
const httpCircuit = new Map<string, { failures: number; skipUntil: number }>()

async function sshProbe(host: string, key: string): Promise<'up' | 'down'> {
  try {
    await sshExec(host, 'echo ok', key)
    return 'up'
  } catch {
    return 'down'
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

async function httpProbe(url: string): Promise<'up' | 'down'> {
  const circuit = httpCircuit.get(url)
  if (circuit && Date.now() < circuit.skipUntil) {
    return 'down'
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      httpCircuit.delete(url)
      return 'up'
    }
    recordHttpFailure(url)
    return 'down'
  } catch {
    recordHttpFailure(url)
    return 'down'
  }
}

async function poll(): Promise<void> {
  const projects = await discoverProjects().catch(() => [])

  await Promise.allSettled(
    projects.map(async ({ config }) => {
      const host = config.serverIp ?? config.domain
      const key = sshKeyPath(config.sshKeyName)
      const next = await sshProbe(host, key)
      const prev = sshState.get(config.name)

      if (prev === 'up' && next === 'down') {
        await sendToAll({
          title: config.name,
          body: 'Service is down — SSH unreachable.',
          url: `/projects/${encodeURIComponent(config.name)}`,
          tag: `down:${config.name}`,
        }).catch(() => {/* push failures are best-effort */})
        writeIncident({ type: 'ssh', projectName: config.name, event: 'down', t: Math.floor(Date.now() / 1000) })
      } else if (prev === 'down' && next === 'up') {
        await sendToAll({
          title: config.name,
          body: 'Service is back online.',
          url: `/projects/${encodeURIComponent(config.name)}`,
          tag: `up:${config.name}`,
        }).catch(() => {/* push failures are best-effort */})
        writeIncident({ type: 'ssh', projectName: config.name, event: 'up', t: Math.floor(Date.now() / 1000) })
      }

      sshState.set(config.name, next)

      if (config.healthCheck?.url) {
        const httpNext = await httpProbe(config.healthCheck.url)
        const httpPrev = httpState.get(config.name)

        if (httpPrev === 'up' && httpNext === 'down') {
          await sendToAll({
            title: config.name,
            body: 'Health check failing — app may be down.',
            url: `/projects/${encodeURIComponent(config.name)}`,
            tag: `http-down:${config.name}`,
          }).catch(() => {/* push failures are best-effort */})
          writeIncident({ type: 'http', projectName: config.name, event: 'down', t: Math.floor(Date.now() / 1000) })
        } else if (httpPrev === 'down' && httpNext === 'up') {
          await sendToAll({
            title: config.name,
            body: 'Health check passing — app is back up.',
            url: `/projects/${encodeURIComponent(config.name)}`,
            tag: `http-up:${config.name}`,
          }).catch(() => {/* push failures are best-effort */})
          writeIncident({ type: 'http', projectName: config.name, event: 'up', t: Math.floor(Date.now() / 1000) })
        }

        httpState.set(config.name, httpNext)
      }
    }),
  )
}

export function startStatusMonitor(): void {
  // Delay first poll by 10 s to let the server finish booting.
  setTimeout(() => {
    void poll()
    setInterval(() => void poll(), POLL_MS)
  }, 10_000)
}
