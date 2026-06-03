import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { runAnsible, runTerraform } from '@emit-infra/core'
import { discoverProjects } from '../lib/discover-projects.js'
import { writeEvent } from '../lib/write-sse.js'
import { streamProcess } from '../lib/stream-process.js'

const DEFAULT_SSH_KEY = join(homedir(), '.ssh', 'emit-deploy')

function sshKeyPath(): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? DEFAULT_SSH_KEY
}

function findProject(name: string) {
  return discoverProjects().find((p) => p.config.name === name) ?? null
}

export async function operationRoutes(app: FastifyInstance) {
  app.post<{ Params: { name: string } }>('/projects/:name/deploy', async (req, reply) => {
    const project = findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const inventory = join(homedir(), 'projects', req.params.name, 'inventory.ini')

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    let exitCode = 0
    try {
      await runAnsible('deploy', inventory, { project_name: req.params.name }, (stream, text) => {
        writeEvent(reply.raw, { type: 'line', stream, text })
      })
    } catch {
      exitCode = 1
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  })

  app.post<{ Params: { name: string }; Body: { config?: Record<string, unknown> } }>(
    '/projects/:name/provision',
    async (req, reply) => {
    const name = req.params.name
    const existing = findProject(name)

    if (!existing) {
      const config = req.body?.config
      if (!config) return reply.status(404).send({ error: 'not found' })
      const projectDir = join(homedir(), 'projects', name)
      await mkdir(projectDir, { recursive: true })
      await writeFile(join(projectDir, '.emit-infra.json'), JSON.stringify(config, null, 2))
    }

    const terraformDir = join(homedir(), 'projects', name, 'terraform')

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    let exitCode = 0
    try {
      await runTerraform('apply', ['-auto-approve'], terraformDir, (stream, text) => {
        writeEvent(reply.raw, { type: 'line', stream, text })
      })
    } catch {
      exitCode = 1
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  },
  )

  app.post<{ Params: { name: string } }>('/projects/:name/destroy', async (req, reply) => {
    const project = findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const terraformDir = join(homedir(), 'projects', req.params.name, 'terraform')

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    let exitCode = 0
    try {
      await runTerraform('destroy', ['-auto-approve'], terraformDir, (stream, text) => {
        writeEvent(reply.raw, { type: 'line', stream, text })
      })
    } catch {
      exitCode = 1
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  })

  app.get<{ Params: { name: string }; Querystring: { service?: string } }>(
    '/projects/:name/logs',
    async (req, reply) => {
      const project = findProject(req.params.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath()
      const host = project.config.domain
      const service = req.query.service ?? ''

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      const remoteCmd = service
        ? `docker compose logs --follow --tail=100 ${service}`
        : 'docker compose logs --follow --tail=100'

      const sshArgs = [
        '-i',
        key,
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'ConnectTimeout=10',
        `root@${host}`,
        remoteCmd,
      ]

      const controller = new AbortController()
      req.raw.on('close', () => controller.abort())

      for await (const event of streamProcess('ssh', sshArgs, { signal: controller.signal })) {
        writeEvent(reply.raw, event)
        if (event.type === 'done' || event.type === 'error') break
      }

      reply.raw.end()
    },
  )
}
