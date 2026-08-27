import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { sshExec, classifyRunState, type DeployStatusRecord } from '@emit-infra/core'
import { findProject, sshKeyPath, SAFE_NAME_RE } from '../lib/project-helpers.js'
import { createTtlCache } from '../lib/ttl-cache.js'
import { buildStatusCommand, parseStatusLines } from '../lib/status-command.js'

const STATUS_TTL = 20_000
type StatusData = {
  uptime: string
  disk: number | undefined; diskUsed: string; diskTotal: string
  memory: number | undefined; memUsed: string; memTotal: string
  containerCount: number | undefined; containerTotal: number | undefined; containerUnhealthy: number | undefined
  httpStatus: number | null
  serverType: string | undefined; region: string | undefined; ip: string
  buildNumber: string | null
  nginxStatus: string | null
  nginxConfigured: boolean
  sslExpiry: string | null
  redisStatus: string | null
  queueFailed: number | null
  queueWait: number | null
  deployedAt: string | null
  activeSlot: string | null
}

// The status monitor polls every 60s, so a permanently unreachable domain
// would otherwise log an identical line forever and drown real errors — the
// test-smoke fixture's RFC 5737 address is unreachable *by design*. Log the
// first failure and each *change* in failure, then stay quiet until recovery.
const lastHttpFailure = new Map<string, string>()

async function checkHttp(domain: string): Promise<number | null> {
  try {
    const res = await fetch(`https://${domain}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (lastHttpFailure.delete(domain)) {
      console.info(`HTTP check recovered for ${domain}: ${res.status}`)
    }
    return res.status
  } catch (err) {
    const signature = String(err)
    if (lastHttpFailure.get(domain) !== signature) {
      lastHttpFailure.set(domain, signature)
      console.warn(`HTTP check failed for ${domain}: ${err}`)
    }
    return null
  }
}

function toInt(s: string | undefined): number | undefined {
  const n = parseInt(s ?? '', 10)
  return Number.isNaN(n) ? undefined : n
}

async function readProjectConfig(name: string): Promise<Record<string, unknown> | null> {
  const path = join(homedir(), 'projects', name, '.emit-infra.json')
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    console.warn(`[readProjectConfig] failed to read/parse ${path}: ${err}`)
    return null
  }
}

async function lastDeployEpoch(name: string): Promise<string | null> {
  const path = join(homedir(), 'projects', name, '.deploy-history.jsonl')
  try {
    const content = await readFile(path, 'utf8')
    const last = content.trim().split('\n').filter(Boolean).at(-1)
    if (!last) return null
    const entry = JSON.parse(last) as { completedAt?: string }
    if (!entry.completedAt) return null
    return String(Math.floor(new Date(entry.completedAt).getTime() / 1000))
  } catch (err) {
    // A project that has never deployed simply has no history file. That is a
    // normal state, already expressed by the `null` return — warning about it
    // every poll cycle reports a non-problem as a failure.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[lastDeployEpoch] failed to read/parse ${path}: ${err}`)
    }
    return null
  }
}

const statusCache = createTtlCache<StatusData | null>(STATUS_TTL)
const nameSchema = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name') })

// Additive-only: enriches whatever the status file already contains with the
// shared runState classification (sprint 284) — the raw fields the dashboard
// already reads are passed through untouched.
function withRunState(parsed: Record<string, unknown>): Record<string, unknown> {
  return { ...parsed, runState: classifyRunState(parsed as DeployStatusRecord) }
}

export async function projectStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>('/projects/:name/status', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name

    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })

    const cached = statusCache.get(name)
    if (cached !== undefined) {
      return void (cached ? reply.send(cached) : reply.status(503).send({ error: 'unreachable' }))
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const projectConfig = await readProjectConfig(name)

    const domain = project.config.domain

    try {
      const [raw, httpStatus, historyEpoch] = await Promise.all([
        sshExec(host, buildStatusCommand(name, domain), key),
        checkHttp(domain),
        lastDeployEpoch(name),
      ])
      const fields = parseStatusLines(raw)
      const diskParts = fields.disk.split(' ')
      const memParts = fields.mem.split(' ')
      const data: StatusData = {
        uptime: fields.uptime,
        disk: toInt((diskParts[0] ?? '').replace('%', '')),
        diskUsed: diskParts[1] ?? '',
        diskTotal: diskParts[2] ?? '',
        memory: toInt(memParts[0]),
        memUsed: memParts[1] ?? '',
        memTotal: memParts[2] ?? '',
        containerCount: toInt(fields.containersRunning),
        containerTotal: toInt(fields.containersTotal),
        containerUnhealthy: toInt(fields.containersUnhealthy),
        httpStatus,
        serverType: projectConfig?.['serverType'] as string | undefined,
        region: projectConfig?.['region'] as string | undefined,
        ip: host,
        buildNumber: fields.buildNumber || null,
        nginxStatus: fields.nginxStatus && fields.nginxStatus !== 'unknown' ? fields.nginxStatus : null,
        nginxConfigured: fields.nginxConfigured === 'configured',
        sslExpiry: fields.sslExpiry || null,
        redisStatus: fields.redis === 'PONG' ? 'healthy' : fields.redis ? 'unhealthy' : null,
        queueFailed: fields.queue ? parseInt(fields.queue.split(':')[0] ?? '', 10) || 0 : null,
        queueWait: fields.queue ? parseInt(fields.queue.split(':')[1] ?? '', 10) || 0 : null,
        deployedAt: (() => {
          const server = parseInt(fields.deployedAt, 10)
          const history = historyEpoch ? parseInt(historyEpoch, 10) : 0
          const best = Math.max(server || 0, history || 0)
          return best > 0 ? String(best) : null
        })(),
        activeSlot: fields.activeSlot || null,
      }
      statusCache.set(name, data)
      return void reply.send(data)
    } catch {
      statusCache.set(name, null)
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/ci-status', async (req, reply): Promise<void> => {
    const filePath = join(homedir(), 'projects', req.params.name, '.ci-status.json')
    try {
      const raw = await readFile(filePath, 'utf8')
      try {
        return void reply.send(withRunState(JSON.parse(raw) as Record<string, unknown>))
      } catch {
        console.warn(`[ci-status] JSON parse error for ${req.params.name}: ${raw.slice(0, 100)}`)
        return void reply.status(500).send({ error: 'invalid status file' })
      }
    } catch {
      return void reply.status(404).send({ error: 'not found' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/deploy-status', async (req, reply): Promise<void> => {
    const filePath = join(homedir(), 'projects', req.params.name, '.deploy-status.json')
    try {
      const raw = await readFile(filePath, 'utf8')
      try {
        return void reply.send(withRunState(JSON.parse(raw) as Record<string, unknown>))
      } catch {
        console.warn(`[deploy-status] JSON parse error for ${req.params.name}: ${raw.slice(0, 100)}`)
        return void reply.status(500).send({ error: 'invalid status file' })
      }
    } catch {
      return void reply.status(404).send({ error: 'not found' })
    }
  })
}
