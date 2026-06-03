import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { sshExec } from '@emit-infra/core'
import { discoverProjects, discoverUnregistered } from '../lib/discover-projects.js'
import { createTtlCache } from '../lib/ttl-cache.js'

// Concurrent dashboard pollers (multiple tabs/instances) hit these on the same
// interval. Cache the SSH result briefly so they share one round-trip per
// project; null = "unreachable" (negative cache) so a down host isn't re-probed
// on every poll. TTL stays under the dashboard's 30s poll cadence.
const STATUS_TTL = 20_000
type StatusData = {
  uptime: string; disk: number; memory: number; containerCount: number
  serverType: string | undefined; region: string | undefined; ip: string
}
type Container = { name: string; image: string; status: string; state: string }
const statusCache = createTtlCache<StatusData | null>(STATUS_TTL)
const containersCache = createTtlCache<Container[] | null>(STATUS_TTL)

function sshKeyPath(keyName: string): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
}

async function findProject(name: string) {
  return (await discoverProjects()).find((p) => p.config.name === name) ?? null
}

async function readProjectConfig(name: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(homedir(), 'projects', name, '.emit-infra.json'), 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    return (await discoverProjects()).map(({ config, configPath, projectDir }) => ({
      config,
      configPath,
      projectDir,
    }))
  })

  app.get('/projects/unregistered', async () => {
    return discoverUnregistered()
  })

  app.post<{ Params: { name: string }; Body: { config: Record<string, unknown> } }>(
    '/projects/:name/register',
    async (req, reply) => {
      const { name } = req.params
      const projectDir = join(homedir(), 'projects', name)
      if (!existsSync(projectDir)) {
        return reply.status(404).send({ error: 'directory not found' })
      }
      const configPath = join(projectDir, '.emit-infra.json')
      if (existsSync(configPath)) {
        return reply.status(409).send({ error: 'already registered' })
      }
      const config = { name, ...req.body.config }
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
      return { ok: true, configPath }
    },
  )

  app.get('/projects/ssh-keys', async () => {
    const sshDir = join(homedir(), '.ssh')
    try {
      const files = await readdir(sshDir)
      return files.filter(
        (f) => !f.endsWith('.pub') && (f.startsWith('emit-') || f.startsWith('deploy-')),
      )
    } catch {
      return []
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/status', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cached = statusCache.get(req.params.name)
    if (cached !== undefined) {
      return cached ?? reply.status(503).send({ error: 'unreachable' })
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const projectConfig = await readProjectConfig(req.params.name)

    try {
      const raw = await sshExec(
        host,
        "uptime -p; df -h / | tail -1 | awk '{print $5}'; free -m | awk 'NR==2{printf \"%.0f\\n\", $3/$2*100}'; docker ps -q | wc -l",
        key,
      )
      const [uptimeLine, diskLine, memLine, containerLine] = raw.split('\n').map(l => l.trim())
      const data: StatusData = {
        uptime: uptimeLine ?? '',
        disk: parseInt((diskLine ?? '').replace('%', ''), 10),
        memory: parseInt(memLine ?? '', 10),
        containerCount: parseInt(containerLine ?? '', 10),
        serverType: projectConfig?.['serverType'] as string | undefined,
        region: projectConfig?.['region'] as string | undefined,
        ip: host,
      }
      statusCache.set(req.params.name, data)
      return data
    } catch {
      statusCache.set(req.params.name, null)
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/containers', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cached = containersCache.get(req.params.name)
    if (cached !== undefined) {
      return cached ?? reply.status(503).send({ error: 'unreachable' })
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const fmt = '{"name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}"}'

    try {
      const output = await sshExec(host, `docker ps -a --format '${fmt}'`, key)
      const containers = output
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => JSON.parse(line) as Container)
      containersCache.set(req.params.name, containers)
      return containers
    } catch {
      containersCache.set(req.params.name, null)
      return reply.status(503).send({ error: 'unreachable' })
    }
  })
}
