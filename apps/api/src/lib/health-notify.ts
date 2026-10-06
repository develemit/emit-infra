/**
 * Turns http-health.ts state-machine events into push notifications, and
 * seeds fresh state maps from the last recorded incident on startup.
 */

import { discoverProjects } from './discover-projects.js'
import { notify } from './notify.js'
import { incidentsLast7d } from './email-context.js'
import { renderHealthEmail } from './email-templates/health.js'
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

export interface HealthContext {
  serverIp?: string | undefined
  url?: string | undefined
  nowMs?: number
}

async function renderEmail(kind: HealthKind, name: string, event: HealthEvent, ctx: HealthContext) {
  const nowMs = ctx.nowMs ?? Date.now()
  const durationMs = event.kind === 'down' ? 0 : event.downDurationMs
  const incidents7d = await incidentsLast7d(name, kind, nowMs)
  // The recovery record isn't on disk yet, so the outage that just ended still reads as ongoing.
  const last = incidents7d[incidents7d.length - 1]
  if (event.kind === 'up' && last && last.durationMs === undefined) last.durationMs = durationMs
  return renderHealthEmail({
    kind: event.kind,
    check: kind,
    project: name,
    ...(ctx.serverIp && { serverIp: ctx.serverIp }),
    ...(kind === 'http' && ctx.url && { url: ctx.url }),
    ...(event.kind !== 'up' && event.status !== undefined && { status: event.status }),
    downSinceMs: nowMs - durationMs,
    durationMs,
    incidents7d,
    nowMs,
  })
}

export async function handleHealthEvents(kind: HealthKind, name: string, events: HealthEvent[], ctx: HealthContext = {}): Promise<void> {
  for (const event of events) {
    const email = await renderEmail(kind, name, event, ctx).catch(() => undefined)
    await notify({
      severity: 'alert',
      title: name,
      body: bodyFor[kind](event),
      url: `/projects/${encodeURIComponent(name)}`,
      tag: healthTag(kind, event.kind, name),
      ...(email && { email }),
    }).catch(() => {/* best-effort */})
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
