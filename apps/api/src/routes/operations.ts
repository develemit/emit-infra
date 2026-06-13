import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { access, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execa } from 'execa'
import { runAnsible, runTerraform, getTerraformOutput, sshMuxArgs, sshExec } from '@emit-infra/core'
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

function parseEnvFile(content: string): [string, string][] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('=')
      if (idx === -1) return null
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      return [key, value] as [string, string]
    })
    .filter((entry): entry is [string, string] => entry !== null)
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

    const deployVars: Record<string, unknown> = { project_name: name }
    if (project.config.postgres) {
      deployVars['postgres_version'] = project.config.postgres.version ?? '16'
      if (project.config.postgres.backupBucket) {
        deployVars['postgres_backup_bucket'] = project.config.postgres.backupBucket
      }
    }

    let exitCode = 0
    try {
      await Promise.race([
        runAnsible('deploy', inventory, deployVars, (stream, text) => {
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
      } catch {
        // inventory.ini can be written manually if terraform output fails
      }
    }

    writeEvent(reply.raw, { type: 'done', exitCode })
    reply.raw.end()
  },
  )

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

  app.post<{ Params: { name: string }; Body?: { envFile?: string } }>(
    '/projects/:name/secrets-sync',
    async (req, reply) => {
      const project = await findProject(req.params.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const projectDir = join(homedir(), 'projects', req.params.name)
      const envFilePath = req.body?.envFile
        ?? (existsSync(join(projectDir, '.env.prod'))
          ? join(projectDir, '.env.prod')
          : join(projectDir, '.env'))

      openSse(reply)

      if (!existsSync(envFilePath)) {
        return sseError(reply.raw, `No env file found (.env.prod or .env) in ~/projects/${req.params.name}/`)
      }

      const content = await readFile(envFilePath, 'utf-8')
      const entries = parseEnvFile(content)

      if (entries.length === 0) {
        writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: 'No secrets found in env file.' })
        writeEvent(reply.raw, { type: 'done', exitCode: 0 })
        reply.raw.end()
        return
      }

      let exitCode = 0
      for (const [key, value] of entries) {
        try {
          await execa('gh', ['secret', 'set', key, '--repo', project.config.github.repo], { input: value })
          writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: `set ${key}` })
        } catch (err) {
          writeEvent(reply.raw, { type: 'line', stream: 'stderr', text: `failed ${key}: ${String(err)}` })
          exitCode = 1
          break
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
