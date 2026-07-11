import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { findProject, sshKeyPath, SAFE_NAME_RE, SAFE_CONTAINER_RE } from '../lib/project-helpers.js'
import { createTtlCache } from '../lib/ttl-cache.js'

const STATUS_TTL = 20_000
type Container = { name: string; image: string; status: string; state: string; buildNumber?: string }

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name') })
const containersCache = createTtlCache<Container[] | null>(STATUS_TTL)

export async function projectDockerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>('/projects/:name/docker-usage', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const project = await findProject(nameCheck.data.name)
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
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const project = await findProject(nameCheck.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const result = await sshExec(host, 'docker system prune -af 2>&1; echo "---"; docker system df', key)
      containersCache.invalidate(nameCheck.data.name)
      return void reply.send({ ok: true, output: result })
    } catch {
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  const ContainerRestartParam = z.object({
    name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name'),
    container: z.string().min(1).max(200).regex(SAFE_CONTAINER_RE),
  })

  app.post<{ Params: { name: string; container: string } }>(
    '/projects/:name/containers/:container/restart',
    async (req, reply): Promise<void> => {
      const params = ContainerRestartParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: 'invalid params' })

      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      try {
        const output = await sshExec(host, `docker restart ${params.data.container}`, key)
        containersCache.invalidate(params.data.name)
        return void reply.send({ ok: true, output })
      } catch (err) {
        return void reply.status(503).send({ error: String(err) })
      }
    },
  )

  app.get<{ Params: { name: string } }>('/projects/:name/containers', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const cname = nameCheck.data.name
    const project = await findProject(cname)
    if (!project) return void reply.status(404).send({ error: 'not found' })

    const cached = containersCache.get(cname)
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
      containersCache.set(cname, containers)
      return void reply.send(containers)
    } catch {
      containersCache.set(cname, null)
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })
}
