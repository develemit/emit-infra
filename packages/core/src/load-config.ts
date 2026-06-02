import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { ProjectConfigSchema, type ProjectConfig } from './config.js'

const CONFIG_FILE = '.emit-infra.json'

function findConfigFile(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, CONFIG_FILE)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadConfig(configPath?: string): ProjectConfig {
  const resolvedPath = configPath ?? findConfigFile(process.cwd())

  if (!resolvedPath) {
    throw new Error(
      `Could not find ${CONFIG_FILE}. Run "emit-infra init <name>" to create one, or pass --config.`,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
  } catch {
    throw new Error(`Failed to read config at ${resolvedPath}`)
  }

  const result = ProjectConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid config at ${resolvedPath}:\n${issues}`)
  }

  return result.data
}
