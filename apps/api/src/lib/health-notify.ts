/**
 * Turns http-health.ts state-machine events into push notifications, and
 * seeds fresh state maps from the last recorded incident on startup.
 */

import { discoverProjects } from './discover-projects.js'
import { sendToAll } from './push.js'
import { readLastIncident, writeIncident } from './incidents.js'
import { seedHealthState, causeText, formatDuration, type HealthState, type HealthEvent } from './http-health.js'

export type HealthKind = 'ssh' | 'http'

/** Down and reminder notifications share a tag so a reminder replaces the
 *  stale "down" push on the device instead of stacking another one. */
function healthTag(kind: HealthKind, eventKind: HealthEvent['kind'], name: string): string {
  const prefix = kind === 'http' ? 'http-' : ''
  return eventKind === 'up' ? `${prefix}up:${name}` : `${prefix}down:${name}`
}

function sshBody(event: HealthEvent): string {
  if (event.kind === 'down') return 'Service is down — SSH unreachable.'
  if (event.kind === 'up') return `Service is back online after ${formatDuration(event.downDurationMs)}.`
  return `Still down for ${formatDuration(event.downDurationMs)} — SSH unreachable.`
}

function httpBody(event: HealthEvent): string {
  if (event.kind === 'down') {
    const cause = causeText(event.status)
    return event.status !== undefined ? `Health check failing — ${cause} (HTTP ${event.status}).` : `Health check failing — ${cause}.`
  }
  if (event.kind === 'up') return `Health check passing — back up after ${formatDuration(event.downDurationMs)}.`
  return `Still down for ${formatDuration(event.downDurationMs)} — ${causeText(event.status)}.`
}

const bodyFor: Record<HealthKind, (event: HealthEvent) => string> = { ssh: sshBody, http: httpBody }

export async function handleHealthEvents(kind: HealthKind, name: string, events: HealthEvent[]): Promise<void> {
  for (const event of events) {
    await sendToAll({
      title: name,
      body: bodyFor[kind](event),
      url: `/projects/${encodeURIComponent(name)}`,
      tag: healthTag(kind, event.kind, name),
    }).catch(() => {/* push failures are best-effort */})
    if (event.kind !== 'reminder') {
      writeIncident({ type: kind, projectName: name, event: event.kind, t: Math.floor(Date.now() / 1000) })
    }
  }
}

export async function seedHealthMaps(): Promise<{ ssh: Map<string, HealthState>; http: Map<string, HealthState> }> {
  const projects = await discoverProjects().catch(() => [])
  const now = Date.now()
  const ssh = new Map<string, HealthState>()
  const http = new Map<string, HealthState>()
  await Promise.all(
    projects.map(async ({ config }) => {
      const [sshLast, httpLast] = await Promise.all([
        readLastIncident(config.name, 'ssh'),
        readLastIncident(config.name, 'http'),
      ])
      ssh.set(config.name, seedHealthState(sshLast, now))
      http.set(config.name, seedHealthState(httpLast, now))
    }),
  )
  return { ssh, http }
}
