import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { findProject, sshKeyPath, SAFE_NAME_RE, SAFE_DOMAIN_RE } from '../lib/project-helpers.js'
import { createTtlCache } from '../lib/ttl-cache.js'

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

async function checkHttp(domain: string): Promise<number | null> {
  try {
    const res = await fetch(`https://${domain}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    return res.status
  } catch (err) {
    console.warn(`HTTP check failed for ${domain}: ${err}`)
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
    console.warn(`[lastDeployEpoch] failed to read/parse ${path}: ${err}`)
    return null
  }
}

const statusCache = createTtlCache<StatusData | null>(STATUS_TTL)
const nameSchema = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name') })

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
    // Domain is interpolated into a remote path — only probe the cert when it
    // looks like a real hostname (bare-IP projects have no letsencrypt cert).
    const sslProbe = SAFE_DOMAIN_RE.test(domain)
      ? `openssl x509 -enddate -noout -in /etc/letsencrypt/live/${domain}/fullchain.pem 2>/dev/null | sed 's/notAfter=//' || echo ""`
      : 'echo ""'

    try {
      const [raw, httpStatus, historyEpoch] = await Promise.all([
        sshExec(
          host,
          `uptime -p; df -h / | tail -1 | awk '{print $5, $3, $2}'; free -m | awk 'NR==2{printf "%.0f %dM %dM\\n", $3/$2*100, $3, $2}'; docker ps -q --filter status=running | wc -l; docker ps -aq | wc -l; docker ps -q --filter status=restarting --filter status=dead | wc -l; cat /opt/${name}/.deployed-version 2>/dev/null || echo ""; systemctl is-active nginx 2>/dev/null || echo "unknown"; test -f /etc/nginx/sites-enabled/${name} && echo "configured" || echo "missing"; ${sslProbe}; cd /opt/${name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis timeout 5 redis-cli ping 2>/dev/null || echo ""; cd /opt/${name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis timeout 5 redis-cli eval 'local f=0;local w=0;for _,k in ipairs(redis.call("KEYS","bull:*:failed")) do f=f+redis.call("LLEN",k) end;for _,k in ipairs(redis.call("KEYS","bull:*:wait")) do w=w+redis.call("LLEN",k) end;return tostring(f)..":"..tostring(w)' 0 2>/dev/null || echo ""; cat /opt/${name}/.deployed-at 2>/dev/null || echo ""; cat /opt/${name}/.active-slot 2>/dev/null || echo ""`,
          key,
        ),
        checkHttp(domain),
        lastDeployEpoch(name),
      ])
      const [uptimeLine, diskLine, memLine, containerLine, totalLine, unhealthyLine, buildNumberLine, nginxStatusLine, nginxConfigLine, sslExpiryLine, redisLine, queueLine, deployedAtLine, activeSlotLine] = raw.split('\n').map(l => l.trim())
      const diskParts = (diskLine ?? '').split(' ')
      const memParts = (memLine ?? '').split(' ')
      const data: StatusData = {
        uptime: uptimeLine ?? '',
        disk: toInt((diskParts[0] ?? '').replace('%', '')),
        diskUsed: diskParts[1] ?? '',
        diskTotal: diskParts[2] ?? '',
        memory: toInt(memParts[0]),
        memUsed: memParts[1] ?? '',
        memTotal: memParts[2] ?? '',
        containerCount: toInt(containerLine),
        containerTotal: toInt(totalLine),
        containerUnhealthy: toInt(unhealthyLine),
        httpStatus,
        serverType: projectConfig?.['serverType'] as string | undefined,
        region: projectConfig?.['region'] as string | undefined,
        ip: host,
        buildNumber: buildNumberLine || null,
        nginxStatus: nginxStatusLine && nginxStatusLine !== 'unknown' ? nginxStatusLine : null,
        nginxConfigured: nginxConfigLine === 'configured',
        sslExpiry: sslExpiryLine || null,
        redisStatus: redisLine === 'PONG' ? 'healthy' : redisLine ? 'unhealthy' : null,
        queueFailed: queueLine ? parseInt(queueLine.split(':')[0] ?? '', 10) || 0 : null,
        queueWait: queueLine ? parseInt(queueLine.split(':')[1] ?? '', 10) || 0 : null,
        deployedAt: (() => {
          const server = deployedAtLine ? parseInt(deployedAtLine, 10) : 0
          const history = historyEpoch ? parseInt(historyEpoch, 10) : 0
          const best = Math.max(server || 0, history || 0)
          return best > 0 ? String(best) : null
        })(),
        activeSlot: activeSlotLine || null,
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
        return void reply.send(JSON.parse(raw) as unknown)
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
        return void reply.send(JSON.parse(raw) as unknown)
      } catch {
        console.warn(`[deploy-status] JSON parse error for ${req.params.name}: ${raw.slice(0, 100)}`)
        return void reply.status(500).send({ error: 'invalid status file' })
      }
    } catch {
      return void reply.status(404).send({ error: 'not found' })
    }
  })
}
