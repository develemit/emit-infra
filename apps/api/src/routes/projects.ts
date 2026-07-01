import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { discoverProjects, discoverUnregistered } from '../lib/discover-projects.js'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

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
  } catch (err) {
    console.warn(`HTTP check failed for ${domain}: ${err}`)
    return null
  }
}
type Container = { name: string; image: string; status: string; state: string; buildNumber?: string }
const statusCache = createTtlCache<StatusData | null>(STATUS_TTL)
const containersCache = createTtlCache<Container[] | null>(STATUS_TTL)


async function readProjectConfig(name: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(homedir(), 'projects', name, '.emit-infra.json'), 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
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
    async (req, reply): Promise<void> => {
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
      return void reply.send({ ok: true, configPath })
    },
  )

  const PatchConfigBody = z.object({
    postgres: z.object({
      backupRetainDays: z.number().int().min(1).max(365),
    }).partial(),
  }).partial()

  app.patch<{ Params: { name: string }; Body: unknown }>(
    '/projects/:name/config',
    async (req, reply): Promise<void> => {
      const project = await findProject(req.params.name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const parsed = PatchConfigBody.safeParse(req.body)
      if (!parsed.success) {
        return void reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' })
      }

      const raw = await readFile(project.configPath, 'utf8')
      const current = JSON.parse(raw) as Record<string, unknown>

      if (parsed.data.postgres) {
        const existing = (current['postgres'] ?? {}) as Record<string, unknown>
        current['postgres'] = { ...existing, ...parsed.data.postgres }
      }

      await writeFile(project.configPath, JSON.stringify(current, null, 2) + '\n')
      return void reply.send({ ok: true })
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

  app.get<{ Params: { name: string } }>('/projects/:name/status', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })

    const cached = statusCache.get(req.params.name)
    if (cached !== undefined) {
      return void (cached ? reply.send(cached) : reply.status(503).send({ error: 'unreachable' }))
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const projectConfig = await readProjectConfig(req.params.name)

    const domain = project.config.domain

    try {
      const [raw, httpStatus] = await Promise.all([
        sshExec(
          host,
          `uptime -p; df -h / | tail -1 | awk '{print $5, $3, $2}'; free -m | awk 'NR==2{printf "%.0f %dM %dM\\n", $3/$2*100, $3, $2}'; docker ps -q --filter status=running | wc -l; docker ps -aq | wc -l; docker ps -q --filter status=restarting --filter status=dead | wc -l; cat /opt/${req.params.name}/.deployed-version 2>/dev/null || echo ""; systemctl is-active nginx 2>/dev/null || echo "unknown"; test -f /etc/nginx/sites-enabled/${req.params.name} && echo "configured" || echo "missing"; openssl x509 -enddate -noout -in /etc/letsencrypt/live/${domain}/fullchain.pem 2>/dev/null | sed 's/notAfter=//' || echo ""; cd /opt/${req.params.name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis timeout 5 redis-cli ping 2>/dev/null || echo ""; cd /opt/${req.params.name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis timeout 5 redis-cli eval 'local f=0;local w=0;for _,k in ipairs(redis.call("KEYS","bull:*:failed")) do f=f+redis.call("LLEN",k) end;for _,k in ipairs(redis.call("KEYS","bull:*:wait")) do w=w+redis.call("LLEN",k) end;return tostring(f)..":"..tostring(w)' 0 2>/dev/null || echo ""; cat /opt/${req.params.name}/.deployed-at 2>/dev/null || echo ""`,
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
      return void reply.send(data)
    } catch {
      statusCache.set(req.params.name, null)
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/docker-usage', async (req, reply): Promise<void> => {
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
      return void reply.send(rows)
    } catch {
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.post<{ Params: { name: string } }>('/projects/:name/prune', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const result = await sshExec(host, 'docker system prune -af 2>&1; echo "---"; docker system df', key)
      statusCache.invalidate(req.params.name)
      return void reply.send({ ok: true, output: result })
    } catch {
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.post<{ Params: { name: string; container: string } }>(
    '/projects/:name/containers/:container/restart',
    async (req, reply): Promise<void> => {
      const project = await findProject(req.params.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      try {
        const output = await sshExec(host, `docker restart ${req.params.container}`, key)
        containersCache.invalidate(req.params.name)
        return void reply.send({ ok: true, output })
      } catch (err) {
        return void reply.send({ ok: false, output: String(err) })
      }
    },
  )

  app.get<{ Params: { name: string } }>('/projects/:name/backup-status', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const raw = await sshExec(host, `cat /opt/${req.params.name}/.backup-status.json 2>/dev/null || echo ""`, key)
      if (!raw.trim()) return void reply.status(404).send({ error: 'no backup status' })
      try {
        return void reply.send(JSON.parse(raw.trim()) as unknown)
      } catch {
        console.warn(`[backup-status] JSON parse error for ${req.params.name}: ${raw.slice(0, 100)}`)
        return void reply.status(500).send({ error: 'invalid status file' })
      }
    } catch {
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  const BACKUP_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.dump$/

  app.get<{ Params: { name: string } }>('/projects/:name/backups', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    const bucket = project.config.postgres?.backupBucket
    if (!bucket) return void reply.status(404).send({ error: 'no backup bucket configured' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const name = req.params.name

    const cmd = `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto" aws s3 ls "s3://${bucket}/" --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"`

    try {
      const raw = await sshExec(host, cmd, key)
      const backups = raw
        .split('\n')
        .filter(l => l.trim())
        .map(line => {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 4) return null
          const [date, time, size, backupKey] = parts
          if (!date || !time || !size || !backupKey) return null
          return { key: backupKey, sizeBytes: parseInt(size, 10), lastModified: `${date}T${time}Z` }
        })
        .filter((b): b is { key: string; sizeBytes: number; lastModified: string } => b !== null)
        .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      return void reply.send({ backups })
    } catch {
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.delete<{ Params: { name: string; key: string } }>('/projects/:name/backups/:key', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    const bucket = project.config.postgres?.backupBucket
    if (!bucket) return void reply.status(404).send({ error: 'no backup bucket configured' })
    if (!BACKUP_KEY_RE.test(req.params.key)) return void reply.status(400).send({ error: 'invalid key' })

    const sshKey = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const name = req.params.name
    const backupKey = req.params.key

    const cmd = `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto" aws s3 rm "s3://${bucket}/${backupKey}" --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"`

    try {
      await sshExec(host, cmd, sshKey)
      return void reply.send({ ok: true })
    } catch (err) {
      return void reply.send({ ok: false, error: String(err) })
    }
  })

  app.post<{ Params: { name: string } }>('/projects/:name/backups/trigger', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    if (!project.config.postgres?.backupBucket) return void reply.status(404).send({ error: 'no backup bucket configured' })

    const sshKey = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const name = req.params.name

    try {
      const output = await sshExec(host, `/usr/local/bin/emit-db-backup-${name} 2>&1`, sshKey)
      return void reply.send({ ok: true, output })
    } catch (err) {
      return void reply.send({ ok: false, output: String(err) })
    }
  })

  app.get<{ Params: { name: string; key: string } }>('/projects/:name/backups/:key/download', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    const bucket = project.config.postgres?.backupBucket
    if (!bucket) return void reply.status(404).send({ error: 'no backup bucket configured' })
    if (!BACKUP_KEY_RE.test(req.params.key)) return void reply.status(400).send({ error: 'invalid key' })

    const sshKey = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const name = req.params.name
    const backupKey = req.params.key

    const cmd = `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto" aws s3 presign "s3://${bucket}/${backupKey}" --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com" --expires-in 3600`

    try {
      const url = (await sshExec(host, cmd, sshKey)).trim()
      return void reply.send({ url })
    } catch {
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

  app.get<{ Params: { name: string } }>('/projects/:name/containers', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })

    const cached = containersCache.get(req.params.name)
    if (cached !== undefined) {
      return void (cached ? reply.send(cached) : reply.status(503).send({ error: 'unreachable' }))
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const fmt = '{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Label "build.number"}}'

    try {
      const output = await sshExec(host, `timeout 30 docker ps -a --format '${fmt}'`, key)
      const containers = output
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          const [name, image, status, state, buildNumber] = line.split('|')
          return { name, image, status, state, buildNumber: buildNumber || undefined } as Container
        })
      containersCache.set(req.params.name, containers)
      return void reply.send(containers)
    } catch {
      containersCache.set(req.params.name, null)
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })
}
