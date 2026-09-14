/**
 * Append-only .incidents.jsonl log of each project's ssh/http up/down
 * transitions. Read on monitor startup to seed http-health.ts state across
 * restarts — see lib/health-notify.ts.
 */

import { appendFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface IncidentRecord {
  type: 'ssh' | 'http'
  projectName: string
  event: 'down' | 'up'
  t: number
}

export function writeIncident(record: IncidentRecord): void {
  const path = join(homedir(), 'projects', record.projectName, '.incidents.jsonl')
  appendFile(path, JSON.stringify(record) + '\n').catch((err) => console.error('[incidents] writeIncident failed:', err))
}

export async function readLastIncident(name: string, type: 'ssh' | 'http'): Promise<{ event: 'up' | 'down'; t: number } | undefined> {
  try {
    const path = join(homedir(), 'projects', name, '.incidents.jsonl')
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const record = JSON.parse(lines[i]!) as IncidentRecord
      if (record.type === type) return { event: record.event, t: record.t }
    }
  } catch {
    // no incidents file yet — seed as unknown
  }
  return undefined
}
