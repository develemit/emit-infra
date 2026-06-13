import type { FastifyInstance } from 'fastify'
import { sshExec } from '@emit-infra/core'
import { writeEvent } from '../lib/write-sse.js'
import { openSse, sseError } from '../lib/open-sse.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'


export async function rollbackRoutes(app: FastifyInstance) {
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

  app.post<{ Params: { name: string }; Body: { timestamp?: string } }>(
    '/projects/:name/rollback',
    async (req, reply) => {
      const project = await findProject(req.params.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      const appDir = project.config.deploy?.appDir ?? '/app'
      const composeFile = project.config.deploy?.composeDest ?? 'docker-compose.yml'
      const tagStr = req.body?.timestamp ?? 'rollback'

      openSse(reply)

      let exitCode = 0
      try {
        const images = await sshExec(host, `cd ${appDir} && docker compose -f ${composeFile} config --images`, key)
        const imageList = images.split('\n').map(l => l.trim()).filter(Boolean)

        if (imageList.length === 0) {
          return sseError(reply.raw, 'No images found in compose config')
        }

        const tagScript = imageList
          .map(img => {
            const base = img.split(':')[0]!
            return `docker tag "${base}:${tagStr}" "${base}:latest"`
          })
          .join(' && ')

        writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: `Tagging :${tagStr} as :latest...` })
        await sshExec(host, tagScript, key)
        writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: 'Tagged. Restarting app stack...' })

        const upOut = await sshExec(host, `cd ${appDir} && docker compose -f ${composeFile} up -d --remove-orphans`, key)
        for (const line of upOut.split('\n').map(l => l.trim()).filter(Boolean)) {
          writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: line })
        }
        writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: 'Rollback complete.' })
      } catch (err) {
        exitCode = 1
        writeEvent(reply.raw, { type: 'line', stream: 'stderr', text: `Error: ${String(err)}` })
      }

      writeEvent(reply.raw, { type: 'done', exitCode })
      reply.raw.end()
    },
  )
}
