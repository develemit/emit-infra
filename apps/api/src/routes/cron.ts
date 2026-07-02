import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const CRON_TTL = 120_000

export interface CronJob {
  schedule: string
  command: string
  user?: string
  source: string
}

const cronCache = createTtlCache<CronJob[] | null>(CRON_TTL)

const ENV_RE = /^[A-Z_][A-Z0-9_]*\s*=/
const SECTION_RE = /^===\s*(.+?)\s*===$/
const FILE_RE = /^---\s*(.+?)\s*---$/

function parseCronLines(block: string, source: string, hasUserField: boolean): CronJob[] {
  const jobs: CronJob[] = []
  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || ENV_RE.test(line)) continue
    const parts = line.split(/\s+/)
    if (parts.length < (hasUserField ? 7 : 6)) continue
    const schedule = parts.slice(0, 5).join(' ')
    if (hasUserField) {
      const user = parts[5] ?? ''
      const command = parts.slice(6).join(' ')
      jobs.push({ schedule, command, user, source })
    } else {
      const command = parts.slice(5).join(' ')
      jobs.push({ schedule, command, source })
    }
  }
  return jobs
}

function parseCronOutput(raw: string): CronJob[] {
  const jobs: CronJob[] = []
  let currentSection = ''
  let currentFile = ''
  let blockLines: string[] = []

  function flush() {
    if (!blockLines.length || !currentSection) return
    const block = blockLines.join('\n')
    if (currentSection === '/etc/cron.d/') {
      if (currentFile) {
        jobs.push(...parseCronLines(block, currentFile, true))
      }
    } else if (currentSection === '/var/spool/cron/crontabs/root') {
      jobs.push(...parseCronLines(block, '/var/spool/cron/crontabs/root', false))
    } else if (currentSection === 'crontab -l') {
      jobs.push(...parseCronLines(block, 'crontab -l', false))
    }
    blockLines = []
  }

  for (const line of raw.split('\n')) {
    const secMatch = SECTION_RE.exec(line.trim())
    if (secMatch) {
      flush()
      currentSection = secMatch[1] ?? ''
      currentFile = ''
      continue
    }
    const fileMatch = FILE_RE.exec(line.trim())
    if (fileMatch) {
      flush()
      currentFile = fileMatch[1] ?? ''
      blockLines = []
      continue
    }
    blockLines.push(line)
  }
  flush()
  return jobs
}

const CronJobBody = z.object({
  schedule: z.string().min(9).max(100).regex(
    /^(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)$/,
    'invalid cron schedule',
  ),
  command: z.string().min(1).max(500).regex(/^[^\n\r]+$/, 'command must be single-line'),
})

const CronDeleteBody = z.object({
  schedule: z.string().min(1).max(100),
  command: z.string().min(1).max(500),
})

function escapeSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''")
}

export async function cronRoutes(app: FastifyInstance): Promise<void> {
  const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

  app.get<{ Params: { name: string } }>(
    '/projects/:name/cron-jobs',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const cached = cronCache.get(name)
      if (cached !== undefined) return void reply.send({ jobs: cached ?? [] })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      const cmd = [
        "echo '=== /etc/cron.d/ ==='",
        "ls /etc/cron.d/ 2>/dev/null | while read f; do echo \"--- /etc/cron.d/$f ---\"; cat \"/etc/cron.d/$f\" 2>/dev/null; done",
        "echo '=== /var/spool/cron/crontabs/root ==='",
        "cat /var/spool/cron/crontabs/root 2>/dev/null || true",
        "echo '=== crontab -l ==='",
        "crontab -l 2>/dev/null || true",
      ].join(' && ')

      try {
        const raw = await sshExec(host, cmd, key)
        const jobs = parseCronOutput(raw)
        cronCache.set(name, jobs)
        return void reply.send({ jobs })
      } catch {
        cronCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )

  app.post<{ Params: { name: string } }>(
    '/projects/:name/cron-jobs',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const body = CronJobBody.safeParse(req.body)
      if (!body.success) return void reply.status(400).send({ error: 'invalid body', details: body.error.flatten() })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      const entry = `${body.data.schedule} ${body.data.command}`
      const escaped = escapeSingleQuote(entry)
      const cmd = `(crontab -l 2>/dev/null; echo '${escaped}') | crontab -`

      try {
        await sshExec(host, cmd, key)
        cronCache.set(name, null)
        return void reply.status(201).send({ ok: true })
      } catch {
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )

  app.delete<{ Params: { name: string } }>(
    '/projects/:name/cron-jobs',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const body = CronDeleteBody.safeParse(req.body)
      if (!body.success) return void reply.status(400).send({ error: 'invalid body', details: body.error.flatten() })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      const entry = `${body.data.schedule} ${body.data.command}`
      const escaped = escapeSingleQuote(entry)
      const cmd = `crontab -l 2>/dev/null | grep -vxF '${escaped}' | crontab -`

      try {
        await sshExec(host, cmd, key)
        cronCache.set(name, null)
        return void reply.send({ ok: true })
      } catch {
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
