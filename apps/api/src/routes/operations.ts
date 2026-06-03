import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { runAnsible, runTerraform } from '@emit-infra/core'
import { discoverProjects } from '../lib/discover-projects.js'
import { writeEvent } from '../lib/write-sse.js'
import { streamProcess } from '../lib/stream-process.js'

const DEFAULT_SSH_KEY = join(homedir(), '.ssh', 'emit-deploy')
const OPERATION_TIMEOUT_MS = 15 * 60 * 1000

function operationTimeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), OPERATION_TIMEOUT_MS),
  )
}

function sseError(raw: import('node:http').ServerResponse, message: string) {
  writeEvent(raw, { type: 'error', message })
  writeEvent(raw, { type: 'done', exitCode: 1 })
  raw.end()
}

function openSse(reply: { hijack(): void; raw: import('node:http').ServerResponse }) {
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}

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

    const name = req.params.name
    const inventory = join(homedir(), 'projects', name, 'inventory.ini')

    openSse(reply)

    try { await access(inventory) } catch {
      return sseError(reply.raw, `inventory.ini not found at ~/projects/${name}/inventory.ini`)
    }

    let exitCode = 0
    try {
      await Promise.race([
        runAnsible('deploy', inventory, { project_name: name }, (stream, text) => {
          writeEvent(reply.raw, { type: 'line', stream, text })
        }),
        operationTimeout(),
      ])
    } catch (err) {
      exitCode = 1
      if (err instanceof Error && err.message === 'timeout') {
        writeEvent(reply.raw, { type: 'error', message: 'Operation timed out after 15 minutes' })
      }
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

    openSse(reply)

    try { await access(terraformDir) } catch {
      return sseError(reply.raw, `terraform/ directory not found at ~/projects/${name}/terraform`)
    }

    let exitCode = 0
    try {
      await Promise.race([
        runTerraform('apply', ['-auto-approve'], terraformDir, (stream, text) => {
          writeEvent(reply.raw, { type: 'line', stream, text })
        }),
        operationTimeout(),
      ])
    } catch (err) {
      exitCode = 1
      if (err instanceof Error && err.message === 'timeout') {
        writeEvent(reply.raw, { type: 'error', message: 'Operation timed out after 15 minutes' })
      }
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  },
  )

  app.post<{ Params: { name: string } }>('/projects/:name/destroy', async (req, reply) => {
    const project = findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const name = req.params.name
    const terraformDir = join(homedir(), 'projects', name, 'terraform')

    openSse(reply)

    try { await access(terraformDir) } catch {
      return sseError(reply.raw, `terraform/ directory not found at ~/projects/${name}/terraform`)
    }

    let exitCode = 0
    try {
      await Promise.race([
        runTerraform('destroy', ['-auto-approve'], terraformDir, (stream, text) => {
          writeEvent(reply.raw, { type: 'line', stream, text })
        }),
        operationTimeout(),
      ])
    } catch (err) {
      exitCode = 1
      if (err instanceof Error && err.message === 'timeout') {
        writeEvent(reply.raw, { type: 'error', message: 'Operation timed out after 15 minutes' })
      }
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
