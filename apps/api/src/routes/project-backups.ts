import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { findProject, sshKeyPath, SAFE_NAME_RE } from '../lib/project-helpers.js'

const BACKUP_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.dump$/
const nameSchema = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name') })

export async function projectBackupsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>('/projects/:name/backup-status', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name
    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const raw = await sshExec(host, `cat /opt/${name}/.backup-status.json 2>/dev/null || echo ""`, key)
      if (!raw.trim()) return void reply.status(404).send({ error: 'no backup status' })
      try {
        return void reply.send(JSON.parse(raw.trim()) as unknown)
      } catch {
        console.warn(`[backup-status] JSON parse error for ${name}: ${raw.slice(0, 100)}`)
        return void reply.status(500).send({ error: 'invalid status file' })
      }
    } catch {
      return reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.get<{ Params: { name: string } }>('/projects/:name/backups', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name
    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    const bucket = project.config.postgres?.backupBucket
    if (!bucket) return void reply.status(404).send({ error: 'no backup bucket configured' })

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    const cmd = `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto" aws s3 ls "s3://${bucket}/" --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"`

    try {
      const raw = await sshExec(host, cmd, key)
      const backups = raw
        .split('\n')
        .filter(l => l.trim())
        .map(line => {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 4) return null
          const [date, time, size, backupKey] = parts
          if (!date || !time || !size || !backupKey) return null
          return { key: backupKey, sizeBytes: parseInt(size, 10), lastModified: `${date}T${time}Z` }
        })
        .filter((b): b is { key: string; sizeBytes: number; lastModified: string } => b !== null)
        .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      return void reply.send({ backups })
    } catch {
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })

  app.delete<{ Params: { name: string; key: string } }>('/projects/:name/backups/:key', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name
    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    const bucket = project.config.postgres?.backupBucket
    if (!bucket) return void reply.status(404).send({ error: 'no backup bucket configured' })
    if (!BACKUP_KEY_RE.test(req.params.key)) return void reply.status(400).send({ error: 'invalid key' })

    const sshKey = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const backupKey = req.params.key

    const cmd = `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto" aws s3 rm "s3://${bucket}/${backupKey}" --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"`

    try {
      await sshExec(host, cmd, sshKey)
      return void reply.send({ ok: true })
    } catch (err) {
      return void reply.status(503).send({ error: String(err) })
    }
  })

  app.post<{ Params: { name: string } }>('/projects/:name/backups/trigger', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name
    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    if (!project.config.postgres?.backupBucket) return void reply.status(404).send({ error: 'no backup bucket configured' })

    const sshKey = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const output = await sshExec(host, `/usr/local/bin/emit-db-backup-${name} 2>&1`, sshKey)
      return void reply.send({ ok: true, output })
    } catch (err) {
      return void reply.status(503).send({ error: String(err) })
    }
  })

  app.get<{ Params: { name: string; key: string } }>('/projects/:name/backups/:key/download', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name
    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    const bucket = project.config.postgres?.backupBucket
    if (!bucket) return void reply.status(404).send({ error: 'no backup bucket configured' })
    if (!BACKUP_KEY_RE.test(req.params.key)) return void reply.status(400).send({ error: 'invalid key' })

    const sshKey = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain
    const backupKey = req.params.key

    const cmd = `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto" aws s3 presign "s3://${bucket}/${backupKey}" --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com" --expires-in 3600`

    try {
      const url = (await sshExec(host, cmd, sshKey)).trim()
      return void reply.send({ url })
    } catch {
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })
}
