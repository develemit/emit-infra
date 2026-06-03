import { readdir, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ProjectConfigSchema, type ProjectConfig } from '@emit-infra/core'
import { createTtlCache } from './ttl-cache.js'

export interface DiscoveredProject {
  config: ProjectConfig
  configPath: string
  projectDir: string
}

const PROJECTS_ROOT = join(homedir(), 'projects')
const CACHE_KEY = '__all__'
const CACHE_TTL = 5_000

const projectsCache = createTtlCache<DiscoveredProject[]>(CACHE_TTL)
const unregisteredCache = createTtlCache<string[]>(CACHE_TTL)

export async function discoverProjects(): Promise<DiscoveredProject[]> {
  const cached = projectsCache.get(CACHE_KEY)
  if (cached !== undefined) return cached

  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true }).catch(() => null)
  if (!entries) {
    projectsCache.set(CACHE_KEY, [])
    return []
  }

  const settled = await Promise.allSettled(
    entries
      .filter(e => e.isDirectory())
      .map(async (entry): Promise<DiscoveredProject | null> => {
        const projectDir = join(PROJECTS_ROOT, entry.name)
        const configPath = join(projectDir, '.emit-infra.json')
        try {
          const raw = JSON.parse(await readFile(configPath, 'utf-8')) as unknown
          const result = ProjectConfigSchema.safeParse(raw)
          if (!result.success) {
            console.warn(`[discover] invalid config at ${configPath}: ${result.error.message}`)
            return null
          }
          return { config: result.data, configPath, projectDir }
        } catch {
          return null
        }
      }),
  )

  const results = settled
    .filter((r): r is PromiseFulfilledResult<DiscoveredProject> =>
      r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)

  projectsCache.set(CACHE_KEY, results)
  return results
}

export async function discoverUnregistered(): Promise<string[]> {
  const cached = unregisteredCache.get(CACHE_KEY)
  if (cached !== undefined) return cached

  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true }).catch(() => null)
  if (!entries) {
    unregisteredCache.set(CACHE_KEY, [])
    return []
  }

  const settled = await Promise.allSettled(
    entries
      .filter(e => e.isDirectory())
      .map(async (entry): Promise<string | null> => {
        const configPath = join(PROJECTS_ROOT, entry.name, '.emit-infra.json')
        try {
          await access(configPath)
          return null
        } catch {
          return entry.name
        }
      }),
  )

  const names = settled
    .filter((r): r is PromiseFulfilledResult<string> =>
      r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)
    .sort()

  unregisteredCache.set(CACHE_KEY, names)
  return names
}
