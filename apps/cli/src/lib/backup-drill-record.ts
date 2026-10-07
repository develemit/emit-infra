import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadConfig, type ProjectConfig } from '@emit-infra/core'

export interface DrillTarget {
  config: ProjectConfig
  dir: string
}

export interface DrillRecord {
  t: string
  key: string
  bytes: number
  durationSec: number
  tables: number
  ok: boolean
  error?: string
}

export const drillLogPath = (name: string): string => join(homedir(), '.emit-infra', name, 'restore-drills.jsonl')

export function discoverTargets(projectsRoot = join(homedir(), 'projects')): DrillTarget[] {
  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(projectsRoot, e.name, '.emit-infra.json')))
    .flatMap((e) => {
      const dir = join(projectsRoot, e.name)
      try {
        return [{ config: loadConfig(join(dir, '.emit-infra.json')), dir }]
      } catch {
        return []
      }
    })
}

export function recordDrill(name: string, record: DrillRecord): void {
  const path = drillLogPath(name)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`)
}

export function lastDrill(name: string): DrillRecord | null {
  const path = drillLogPath(name)
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean)
  const last = lines.at(-1)
  return last ? (JSON.parse(last) as DrillRecord) : null
}
