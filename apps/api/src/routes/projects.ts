import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sshExec } from '@emit-infra/core'
import { discoverProjects } from '../lib/discover-projects.js'

const DEFAULT_SSH_KEY = join(homedir(), '.ssh', 'emit-deploy')

function sshKeyPath(): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? DEFAULT_SSH_KEY
}

function findProject(name: string) {
  return discoverProjects().find((p) => p.config.name === name) ?? null
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    return discoverProjects().map(({ config, configPath, projectDir }) => ({
      config,
      configPath,
      projectDir,
    }))
  })

  app.get<{ Params: { name: string } }>('/projects/:name/status', async (req, reply) => {
    const project = findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath()
    const host = project.config.domain

    try {
      const [uptime, disk, mem] = await Promise.all([
        sshExec(host, 'uptime -p', key),
        sshExec(host, "df -h / | tail -1 | awk '{print $5}'", key),
        sshExec(host, "free -m | awk 'NR==2{printf \"%.0f\", $3/$2*100}'", key),
      ])
      return {
        uptime: uptime.trim(),
        disk: parseInt(disk.trim().replace('%', ''), 10),
        memory: parseInt(mem.trim(), 10),
      }
    } catch {
      return { error: 'unreachable' }
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/containers', async (req, reply) => {
    const project = findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath()
    const host = project.config.domain
    const fmt = '{"name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}"}'

    try {
      const output = await sshExec(host, `docker ps --format '${fmt}'`, key)
      const containers = output
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => JSON.parse(line) as { name: string; image: string; status: string; state: string })
      return containers
    } catch {
      return { error: 'unreachable' }
    }
  })
}
