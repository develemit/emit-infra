import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { runAnsible, runTerraform, getTerraformOutput, sshMuxArgs } from '@emit-infra/core'
import { scaffoldProject, writeInventory } from '../lib/scaffold-project.js'
import { discoverProjects } from '../lib/discover-projects.js'
import { writeEvent } from '../lib/write-sse.js'
import { streamProcess } from '../lib/stream-process.js'


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
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
}

function sshKeyPath(keyName = 'emit-deploy'): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
}

async function findProject(name: string) {
  return (await discoverProjects()).find((p) => p.config.name === name) ?? null
}

export async function operationRoutes(app: FastifyInstance) {
  app.post<{ Params: { name: string } }>('/projects/:name/deploy', async (req, reply) => {
    const project = await findProject(req.params.name)
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
    const existing = await findProject(name)
    const config = req.body?.config

    if (!existing) {
      if (!config) return reply.status(404).send({ error: 'not found' })
      const projectDir = join(homedir(), 'projects', name)
      await mkdir(projectDir, { recursive: true })
      await writeFile(join(projectDir, '.emit-infra.json'), JSON.stringify(config, null, 2))
    }

    if (config) {
      await scaffoldProject({
        name,
        domain: (config['domain'] as string) ?? '',
        ...(config['region'] ? { region: config['region'] as string } : {}),
        ...(config['serverType'] ? { serverType: config['serverType'] as string } : {}),
        ...(config['sshKey'] ? { sshKey: config['sshKey'] as string } : {}),
      })
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

    if (exitCode === 0) {
      try {
        const ip = await getTerraformOutput('server_ip', terraformDir)
        await writeInventory(name, ip)
      } catch {
        // inventory.ini can be written manually if terraform output fails
      }
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  },
  )

  app.post<{ Params: { name: string } }>('/projects/:name/destroy', async (req, reply) => {
    const project = await findProject(req.params.name)
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
      const project = await findProject(req.params.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      const service = req.query.service ?? ''

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      const remoteCmd = service
        ? `docker logs --tail=500 ${service}`
        : `docker compose -p ${project.config.name} logs --follow --tail=100`

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
      const logTimeout = setTimeout(() => controller.abort(), 30 * 60 * 1000)

      for await (const event of streamProcess('ssh', sshArgs, { signal: controller.signal })) {
        writeEvent(reply.raw, event)
        if (event.type === 'done' || event.type === 'error') break
      }

      clearTimeout(logTimeout)
      reply.raw.end()
    },
  )
}
