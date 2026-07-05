import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { z } from 'zod/v4'
import { runAnsible, runTerraform, getTerraformOutput, sshMuxArgs, sshExec } from '@emit-infra/core'
import { scaffoldProject, writeInventory } from '../lib/scaffold-project.js'
import { writeEvent } from '../lib/write-sse.js'
import { openSse, sseError } from '../lib/open-sse.js'
import { streamProcess } from '../lib/stream-process.js'
import { findProject, sshKeyPath, SAFE_NAME_RE, SAFE_CONTAINER_RE } from '../lib/project-helpers.js'

const NameParam = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name') })
const ProvisionBody = z.object({ config: z.record(z.string(), z.unknown()).optional() })
const LogsQuery = z.object({ service: z.string().min(1).max(200).regex(SAFE_CONTAINER_RE, 'invalid service name').optional() })

const OPERATION_TIMEOUT_MS = 15 * 60 * 1000

function operationTimeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), OPERATION_TIMEOUT_MS),
  )
}


export async function operationRoutes(app: FastifyInstance) {
  app.post(
    '/projects/:name/provision',
    async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const body = ProvisionBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.message })

    const name = params.data.name
    const existing = await findProject(name)
    const config = body.data.config

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
        ...(config['sshKeyName'] ? { sshKey: config['sshKeyName'] as string } : {}),
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
        await writeInventory(name, ip, (config?.['sshKeyName'] as string | undefined) ?? 'emit-deploy')
      } catch (err) {
        app.log.error({ err, project: name }, 'failed to write inventory after terraform apply')
        writeEvent(reply.raw, { type: 'error', message: `inventory write failed: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  },
  )

  app.post('/projects/:name/destroy', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const name = params.data.name
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

  app.get(
    '/projects/:name/logs',
    async (req, reply) => {
      const params = NameParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: params.error.message })
      const query = LogsQuery.safeParse(req.query)
      if (!query.success) return reply.status(400).send({ error: query.error.message })

      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      const service = query.data.service ?? ''

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      const name = project.config.name
      const remoteCmd = service
        ? `docker logs --follow --tail=500 '${service}'`
        : `PROJECTS=$(docker compose ls 2>/dev/null | awk 'NR>1 && $1~/^${name}(-[^ ]+)?$/{print $1}'); [ -z "$PROJECTS" ] && PROJECTS="${name}"; for P in $PROJECTS; do docker compose -p "$P" logs --follow --tail=50 & done; wait`

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
