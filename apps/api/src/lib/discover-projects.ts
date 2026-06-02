import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ProjectConfigSchema, type ProjectConfig } from '@emit-infra/core'

export interface DiscoveredProject {
  config: ProjectConfig
  configPath: string
  projectDir: string
}

const PROJECTS_ROOT = join(homedir(), 'projects')

export function discoverProjects(): DiscoveredProject[] {
  if (!existsSync(PROJECTS_ROOT)) return []

  const entries = readdirSync(PROJECTS_ROOT, { withFileTypes: true })
  const results: DiscoveredProject[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const projectDir = join(PROJECTS_ROOT, entry.name)
    const configPath = join(projectDir, '.emit-infra.json')

    if (!existsSync(configPath)) continue

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      console.warn(`[discover] failed to read ${configPath}`)
      continue
    }

    const result = ProjectConfigSchema.safeParse(raw)
    if (!result.success) {
      console.warn(`[discover] invalid config at ${configPath}: ${result.error.message}`)
      continue
    }

    results.push({ config: result.data, configPath, projectDir })
  }

  return results
}
