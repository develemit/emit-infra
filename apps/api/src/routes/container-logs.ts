import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { sshMuxArgs } from '@emit-infra/core'
import { openSse, sseError } from '../lib/open-sse.js'
import { writeEvent } from '../lib/write-sse.js'
import { streamProcess } from '../lib/stream-process.js'
import { findProject, sshKeyPath, SAFE_NAME_RE, SAFE_CONTAINER_RE } from '../lib/project-helpers.js'

const NameParam = z.object({
  name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name'),
  container: z.string().min(1).max(200).regex(SAFE_CONTAINER_RE, 'invalid container name'),
})

const LOGS_TIMEOUT_MS = 5 * 60 * 1000

export async function containerLogsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:name/containers/:container/logs', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })

    const { name, container } = params.data

    const project = await findProject(name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    openSse(reply)

    const remoteCmd = `docker logs --tail 200 --follow '${container}'`
    const sshArgs = [
      '-i',
      key,
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'ConnectTimeout=10',
      ...sshMuxArgs(),
      `root@${host}`,
      remoteCmd,
    ]

    const controller = new AbortController()
    req.raw.on('close', () => controller.abort())
    const timeout = setTimeout(() => controller.abort(), LOGS_TIMEOUT_MS)

    try {
      for await (const event of streamProcess('ssh', sshArgs, { signal: controller.signal })) {
        writeEvent(reply.raw, event)
        if (event.type === 'done' || event.type === 'error') break
      }
    } catch (err) {
      sseError(reply.raw, err instanceof Error ? err.message : 'stream error')
      return
    } finally {
      clearTimeout(timeout)
    }

    reply.raw.end()
  })
}
