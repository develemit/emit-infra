/**
 * Weekly digest scheduler.
 *
 * Checks hourly whether a push digest is due (>7 days since last send).
 * Persists last-sent timestamp to ~/.emit-infra/digest-state.json.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { discoverProjects } from './discover-projects.js'
import { readJsonl } from './jsonl.js'
import { sendToAll } from './push.js'
import { buildDigest } from './weekly-digest.js'

const EMIT_DIR = join(homedir(), '.emit-infra')
const STATE_FILE = join(EMIT_DIR, 'digest-state.json')
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000
const CHECK_INTERVAL_MS = 3_600_000 // 1 hour

interface DigestState { lastSentAt: number }

interface IncidentRecord { type: string; event: string; t: number }
interface MetricPoint { t: number; disk: number }

function pairIncidents(records: IncidentRecord[]) {
  const out: { startedAt: number; falsePositive?: boolean }[] = []
  let downAt: number | null = null
  for (const r of records) {
    if (r.event === 'down' && downAt === null) { downAt = r.t }
    else if (r.event === 'up' && downAt !== null) {
      out.push({ startedAt: downAt })
      downAt = null
    }
  }
  if (downAt !== null) out.push({ startedAt: downAt })
  return out
}

async function readState(): Promise<DigestState> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as DigestState
  } catch {
    return { lastSentAt: 0 }
  }
}

async function writeState(state: DigestState): Promise<void> {
  await mkdir(EMIT_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state), { mode: 0o600 })
}

export async function runDigestIfDue(): Promise<void> {
  const state = await readState()
  if (Date.now() - state.lastSentAt < SEVEN_DAYS_MS) return

  try {
    const since = Math.floor((Date.now() - SEVEN_DAYS_MS) / 1000)
    const projects = await discoverProjects()

    const projectData = await Promise.all(
      projects.map(async ({ config }) => {
        const dir = join(homedir(), 'projects', config.name)

        const records = await readJsonl<IncidentRecord>(
          join(dir, '.incidents.jsonl'),
          (r) => typeof r.t === 'number' && r.type === 'ssh' && r.t >= since,
          { tail: 10_000 },
        ).catch(() => [] as IncidentRecord[])

        const deploys = await readJsonl<unknown>(
          join(dir, '.deploy-history.jsonl'),
          (d) => typeof (d as { completedAt?: string }).completedAt === 'string' &&
            new Date((d as { completedAt: string }).completedAt).getTime() / 1000 >= since,
          { tail: 200 },
        ).catch(() => [])

        const metrics = await readJsonl<MetricPoint>(
          join(dir, '.metrics.jsonl'),
          (m) => typeof m.t === 'number' && typeof m.disk === 'number' && m.t >= since,
          { tail: 50_000 },
        ).catch(() => [] as MetricPoint[])

        const diskPctNow = metrics.length > 0 ? metrics[metrics.length - 1]!.disk : undefined
        const diskPctWeekAgo = metrics.length > 0 ? metrics[0]!.disk : undefined

        return {
          project: config.name,
          incidents: pairIncidents(records),
          deploys,
          diskPctNow,
          diskPctWeekAgo,
        }
      }),
    )

    const digest = buildDigest(projectData)

    await sendToAll({
      title: 'Weekly Fleet Digest',
      body: digest.summaryLine,
      url: '/health',
      tag: 'weekly-digest',
    }).catch(() => {/* best-effort */})

    await writeState({ lastSentAt: Date.now() })
  } catch (err) {
    console.error('[digest-scheduler] failed:', err)
  }
}

export function startDigestScheduler(): void {
  setTimeout(() => {
    void runDigestIfDue()
    setInterval(() => void runDigestIfDue(), CHECK_INTERVAL_MS)
  }, 15_000)
}
