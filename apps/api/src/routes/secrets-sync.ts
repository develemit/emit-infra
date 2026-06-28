import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { z } from 'zod/v4'
import { execa } from 'execa'
import { writeEvent } from '../lib/write-sse.js'
import { openSse, sseError } from '../lib/open-sse.js'
import { findProject } from '../lib/project-helpers.js'

const NameParam = z.object({ name: z.string().min(1).max(100) })
const SecretsSyncBody = z.object({
  envFile: z.string().min(1).max(500).refine(s => !s.includes('..'), 'path traversal not allowed').optional(),
})

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

// URL-typed vars that must use Docker service names in production, never localhost.
const URL_KEYS = /^(DATABASE_URL|REDIS_URL|CLICKHOUSE_URL|MONGO_URL|AMQP_URL|BROKER_URL|.*_URL|.*_DSN|.*_HOST)$/i
const LOCALHOST_PATTERN = /\b(localhost|127\.0\.0\.1)\b/

function findLocalhostValues(entries: [string, string][]): [string, string][] {
  return entries.filter(([key, value]) => URL_KEYS.test(key) && LOCALHOST_PATTERN.test(value))
}


export async function secretsSyncRoutes(app: FastifyInstance) {
  app.post(
    '/projects/:name/secrets-sync',
    async (req, reply) => {
      const params = NameParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: params.error.message })
      const body = SecretsSyncBody.safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: body.error.message })

      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const projectDir = join(homedir(), 'projects', params.data.name)
      const envFilePath = body.data.envFile
        ?? (existsSync(join(projectDir, '.env.prod'))
          ? join(projectDir, '.env.prod')
          : join(projectDir, '.env'))

      openSse(reply)

      if (!existsSync(envFilePath)) {
        return sseError(reply.raw, `No env file found (.env.prod or .env) in ~/projects/${params.data.name}/`)
      }

      const content = await readFile(envFilePath, 'utf-8')
      const entries = parseEnvFile(content)

      if (entries.length === 0) {
        writeEvent(reply.raw, { type: 'line', stream: 'stdout', text: 'No secrets found in env file.' })
        writeEvent(reply.raw, { type: 'done', exitCode: 0 })
        reply.raw.end()
        return
      }

      const localhostHits = findLocalhostValues(entries)
      if (localhostHits.length > 0) {
        const keys = localhostHits.map(([k]) => k).join(', ')
        writeEvent(reply.raw, {
          type: 'line', stream: 'stderr',
          text: `ABORT: ${keys} contain localhost URLs — syncing dev defaults to GitHub Secrets would overwrite production values. Sync from .env.prod with Docker service-name URLs instead.`,
        })
        writeEvent(reply.raw, { type: 'done', exitCode: 1 })
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
}
