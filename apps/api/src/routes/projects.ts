import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { discoverProjects, discoverUnregistered } from '../lib/discover-projects.js'
import { findProject } from '../lib/project-helpers.js'

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

  const RegisterBody = z.object({
    config: z.object({
      name: z.string().min(1),
      domain: z.string().min(1),
      sshKeyName: z.string().min(1),
    }).strict().passthrough(),
  })

  app.post<{ Params: { name: string }; Body: unknown }>(
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

      const parsed = RegisterBody.safeParse(req.body)
      if (!parsed.success) {
        const details = parsed.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
        return reply.status(400).send({ error: 'validation failed', details })
      }

      const config = { ...parsed.data.config, name }
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
      return void reply.send({ ok: true, configPath })
    },
  )

  const PatchConfigBody = z.object({
    name: z.never().optional(),
    serverType: z.string().optional(),
    sshKeyName: z.string().optional(),
    region: z.string().optional(),
    domain: z.string().optional(),
    serverIp: z.string().optional(),
    postgres: z.object({
      version: z.string().optional(),
      backupBucket: z.string().optional(),
      backupRetainDays: z.number().int().min(1).max(365).optional(),
    }).optional(),
    requiredEnvKeys: z.string().array().optional(),
    warnThresholds: z.object({
      diskPct: z.number().int().min(1).max(100).optional(),
      memPct: z.number().int().min(1).max(100).optional(),
      backupAgeHours: z.number().int().min(1).optional(),
    }).optional(),
    alertRules: z.array(z.object({
      metric: z.enum(['diskPct', 'memPct', 'certDays', 'backupAgeHours']),
      op: z.enum(['gt', 'lt']),
      threshold: z.number(),
      enabled: z.boolean(),
    })).optional(),
  }).partial()

  app.patch<{ Params: { name: string }; Body: unknown }>(
    '/projects/:name/config',
    async (req, reply): Promise<void> => {
      const project = await findProject(req.params.name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      if (typeof req.body === 'object' && req.body !== null && 'name' in req.body) {
        return void reply.status(400).send({ error: 'cannot change project name' })
      }

      const parsed = PatchConfigBody.safeParse(req.body)
      if (!parsed.success) {
        return void reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' })
      }

      let current: Record<string, unknown>
      try {
        current = JSON.parse(await readFile(project.configPath, 'utf8')) as Record<string, unknown>
      } catch {
        return void reply.status(500).send({ error: 'invalid project config' })
      }

      const { postgres, ...topLevel } = parsed.data
      Object.assign(current, topLevel)

      if (postgres) {
        const existing = (current['postgres'] ?? {}) as Record<string, unknown>
        current['postgres'] = { ...existing, ...postgres }
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
}
