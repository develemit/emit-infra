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
  uptime: string
  disk: number; diskUsed: string; diskTotal: string
  memory: number; memUsed: string; memTotal: string
  containerCount: number; containerTotal: number; containerUnhealthy: number
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
}

async function checkHttp(domain: string): Promise<number | null> {
  try {
    const res = await fetch(`https://${domain}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    return res.status
  } catch {
    return null
  }
}
type Container = { name: string; image: string; status: string; state: string; buildNumber?: string }
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

    const domain = project.config.domain

    try {
      const [raw, httpStatus] = await Promise.all([
        sshExec(
          host,
          `uptime -p; df -h / | tail -1 | awk '{print $5, $3, $2}'; free -m | awk 'NR==2{printf "%.0f %dM %dM\\n", $3/$2*100, $3, $2}'; docker ps -q --filter status=running | wc -l; docker ps -aq | wc -l; docker ps -q --filter status=restarting --filter status=dead | wc -l; cat /opt/${req.params.name}/.deployed-version 2>/dev/null || echo ""; systemctl is-active nginx 2>/dev/null || echo "unknown"; test -f /etc/nginx/sites-enabled/${req.params.name} && echo "configured" || echo "missing"; openssl x509 -enddate -noout -in /etc/letsencrypt/live/${domain}/fullchain.pem 2>/dev/null | sed 's/notAfter=//' || echo ""; cd /opt/${req.params.name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis redis-cli ping 2>/dev/null || echo ""; cd /opt/${req.params.name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis redis-cli eval 'local f=0;local w=0;for _,k in ipairs(redis.call("KEYS","bull:*:failed")) do f=f+redis.call("LLEN",k) end;for _,k in ipairs(redis.call("KEYS","bull:*:wait")) do w=w+redis.call("LLEN",k) end;return tostring(f)..":"..tostring(w)' 0 2>/dev/null || echo ""; cat /opt/${req.params.name}/.deployed-at 2>/dev/null || echo ""`,
          key,
        ),
        checkHttp(domain),
      ])
      const [uptimeLine, diskLine, memLine, containerLine, totalLine, unhealthyLine, buildNumberLine, nginxStatusLine, nginxConfigLine, sslExpiryLine, redisLine, queueLine, deployedAtLine] = raw.split('\n').map(l => l.trim())
      const diskParts = (diskLine ?? '').split(' ')
      const memParts = (memLine ?? '').split(' ')
      const data: StatusData = {
        uptime: uptimeLine ?? '',
        disk: parseInt((diskParts[0] ?? '').replace('%', ''), 10),
        diskUsed: diskParts[1] ?? '',
        diskTotal: diskParts[2] ?? '',
        memory: parseInt(memParts[0] ?? '', 10),
        memUsed: memParts[1] ?? '',
        memTotal: memParts[2] ?? '',
        containerCount: parseInt(containerLine ?? '', 10),
        containerTotal: parseInt(totalLine ?? '', 10),
        containerUnhealthy: parseInt(unhealthyLine ?? '', 10),
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
        deployedAt: deployedAtLine || null,
      }
      statusCache.set(req.params.name, data)
      return data
    } catch {
      statusCache.set(req.params.name, null)
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/docker-usage', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const raw = await sshExec(
        host,
        "docker system df --format '{{.Type}}\\t{{.TotalCount}}\\t{{.Active}}\\t{{.Size}}\\t{{.Reclaimable}}'",
        key,
      )
      const rows = raw.split('\n').filter(l => l.trim()).map(line => {
        const [type, total, active, size, reclaimable] = line.split('\t')
        return { type: type ?? '', total: parseInt(total ?? '0', 10), active: parseInt(active ?? '0', 10), size: size ?? '', reclaimable: reclaimable ?? '' }
      })
      return rows
    } catch {
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/rollback/snapshots', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const appDir = project.config.deploy?.appDir ?? '/app'
    const composeFile = project.config.deploy?.composeDest ?? 'docker-compose.yml'

    try {
      const images = await sshExec(host, `cd ${appDir} && docker compose -f ${composeFile} config --images`, key)
      const imageList = images.split('\n').map(l => l.trim()).filter(Boolean)
      if (imageList.length === 0) return { snapshots: [] }

      const bases = [...new Set(imageList.map(img => img.split(':')[0]))]
      const clauses = bases
        .map(base => `docker images --format "{{.Repository}}:{{.Tag}}" "${base}" | grep ":rollback-"`)
        .join(';\n  ')
      const output = await sshExec(host, `{ ${clauses}; } | sort -u -r`, key)
      const snapshots = output.trim().split('\n').map(l => l.trim()).filter(Boolean)
      return { snapshots }
    } catch {
      return { snapshots: [] }
    }
  })

  app.post<{ Params: { name: string } }>('/projects/:name/prune', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const result = await sshExec(host, 'docker system prune -af 2>&1; echo "---"; docker system df', key)
      statusCache.invalidate(req.params.name)
      return { ok: true, output: result }
    } catch {
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.post<{ Params: { name: string; container: string } }>(
    '/projects/:name/containers/:container/restart',
    async (req, reply) => {
      const project = await findProject(req.params.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      try {
        const output = await sshExec(host, `docker restart ${req.params.container}`, key)
        containersCache.invalidate(req.params.name)
        return { ok: true, output }
      } catch (err) {
        return { ok: false, output: String(err) }
      }
    },
  )

  app.get<{ Params: { name: string } }>('/projects/:name/containers', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cached = containersCache.get(req.params.name)
    if (cached !== undefined) {
      return cached ?? reply.status(503).send({ error: 'unreachable' })
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const fmt = '{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Label "build.number"}}'

    try {
      const output = await sshExec(host, `docker ps -a --format '${fmt}'`, key)
      const containers = output
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          const [name, image, status, state, buildNumber] = line.split('|')
          return { name, image, status, state, buildNumber: buildNumber || undefined } as Container
        })
      containersCache.set(req.params.name, containers)
      return containers
    } catch {
      containersCache.set(req.params.name, null)
      return reply.status(503).send({ error: 'unreachable' })
    }
  })
}
