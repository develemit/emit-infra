import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface DetectedService {
  name: string
  internalPort?: number | undefined
}

export function detectServices(cwd: string): DetectedService[] {
  const composeFiles = ['docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.app.yml']
  for (const file of composeFiles) {
    const path = join(cwd, file)
    if (!existsSync(path)) continue
    const services = parseComposeServices(readFileSync(path, 'utf-8'))
    if (services.length > 0) return services
  }

  const appsDir = join(cwd, 'apps')
  if (existsSync(appsDir)) {
    const entries = readdirSync(appsDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && existsSync(join(appsDir, e.name, 'Dockerfile')))
      .map((e) => ({ name: e.name }))
  }

  return [{ name: 'app' }]
}

function parseComposeServices(content: string): DetectedService[] {
  const services: DetectedService[] = []
  const lines = content.split('\n')
  let inServices = false
  let currentService: string | null = null
  const infraNames = new Set(['postgres', 'redis', 'clickhouse', 'postfix', 'opendkim', 'pgbackup', 'db-backup', 'backup'])

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true
      continue
    }
    if (inServices && /^[a-z]/.test(line) && !line.startsWith(' ')) {
      inServices = false
    }
    if (!inServices) continue

    const svcMatch = line.match(/^  ([a-zA-Z0-9_-]+):/)
    if (svcMatch?.[1]) {
      currentService = svcMatch[1]
      if (!infraNames.has(currentService)) {
        services.push({ name: currentService })
      }
      continue
    }

    if (currentService && !infraNames.has(currentService)) {
      const portMatch = line.match(/["']?\d+:(\d+)["']?/)
      if (portMatch?.[1]) {
        const svc = services.find((s) => s.name === currentService)
        if (svc && !svc.internalPort) {
          svc.internalPort = parseInt(portMatch[1], 10)
        }
      }
    }
  }

  return services
}

export function detectHealthPaths(cwd: string): Record<string, string> {
  const paths: Record<string, string> = {}
  const patterns = [
    { regex: /['"`](\/health[z]?)['"`]/g, path: '' },
    { regex: /['"`](\/readyz?)['"`]/g, path: '' },
    { regex: /['"`](\/api\/health[z]?)['"`]/g, path: '' },
  ]

  const srcDirs = ['apps', 'src', 'packages']
  for (const dir of srcDirs) {
    const fullDir = join(cwd, dir)
    if (!existsSync(fullDir)) continue
    scanForHealth(fullDir, patterns, paths, 0)
  }

  return paths
}

function scanForHealth(
  dir: string,
  patterns: { regex: RegExp; path: string }[],
  result: Record<string, string>,
  depth: number,
): void {
  if (depth > 4) return
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        scanForHealth(fullPath, patterns, result, depth + 1)
      } else if (/\.(ts|js|tsx|jsx)$/.test(entry.name)) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          for (const p of patterns) {
            p.regex.lastIndex = 0
            const match = p.regex.exec(content)
            if (match?.[1]) {
              const svcName = extractServiceName(fullPath)
              if (svcName && !result[svcName]) {
                result[svcName] = match[1]
              }
            }
          }
        } catch {}
      }
    }
  } catch {}
}

function extractServiceName(filePath: string): string | null {
  const parts = filePath.split('/')
  const appsIdx = parts.indexOf('apps')
  if (appsIdx >= 0 && appsIdx + 1 < parts.length) {
    return parts[appsIdx + 1] ?? null
  }
  return 'api'
}
