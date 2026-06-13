import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execa } from 'execa'
import { writeEvent } from '../lib/write-sse.js'
import { openSse, sseError } from '../lib/open-sse.js'
import { findProject } from '../lib/project-helpers.js'

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


export async function secretsSyncRoutes(app: FastifyInstance) {
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
}
