import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'
import { normalizeConfig, diffConfigLines } from '../lib/nginx-diff.js'

const DRIFT_TTL = 30_000

type NginxDriftResult =
  | { status: 'unconfigured' }
  | { status: 'missing-local'; localPath: string }
  | { status: 'missing-server'; localPath: string; serverPath: string }
  | { status: 'disabled'; localPath: string; serverPath: string }
  | { status: 'ok' | 'drift'; localPath: string; serverPath: string; localLines: number; serverLines: number; diff: string[] }

const SPLIT_MARKER = '__EMIT_INFRA_NGINX_DRIFT_SPLIT__'
const AVAILABLE_MARKER = '__EMIT_INFRA_NGINX_DRIFT_AVAILABLE__'

const driftCache = createTtlCache<NginxDriftResult | null>(DRIFT_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

export async function nginxConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>(
    '/projects/:name/nginx-drift',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const customConfigSrc = project.config.nginx?.customConfigSrc
      if (!customConfigSrc) {
        return void reply.send({ status: 'unconfigured' })
      }

      const localPath = join(project.projectDir, customConfigSrc)
      const enabledPath = `/etc/nginx/sites-enabled/${name}`
      const availablePath = `/etc/nginx/sites-available/${name}`

      if (!existsSync(localPath)) {
        return void reply.send({ status: 'missing-local', localPath })
      }

      const cached = driftCache.get(name)
      if (cached !== undefined) {
        if (cached === null) return void reply.status(503).send({ error: 'unreachable' })
        return void reply.send(cached)
      }

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      const script = `cat ${enabledPath} 2>/dev/null || true; echo ${SPLIT_MARKER}; test -f ${availablePath} && echo ${AVAILABLE_MARKER} || true`

      try {
        const [localRaw, combinedRaw] = await Promise.all([
          readFile(localPath, 'utf-8'),
          sshExec(host, script, key),
        ])

        const splitIdx = combinedRaw.indexOf(SPLIT_MARKER)
        const serverRaw = splitIdx === -1 ? combinedRaw : combinedRaw.slice(0, splitIdx)
        const tail = splitIdx === -1 ? '' : combinedRaw.slice(splitIdx + SPLIT_MARKER.length)
        const availableExists = tail.includes(AVAILABLE_MARKER)

        if (serverRaw.trim() === '') {
          if (availableExists) {
            const result: NginxDriftResult = { status: 'disabled', localPath, serverPath: availablePath }
            driftCache.set(name, result)
            return void reply.send(result)
          }
          const result: NginxDriftResult = { status: 'missing-server', localPath, serverPath: enabledPath }
          driftCache.set(name, result)
          return void reply.send(result)
        }

        const localLines = normalizeConfig(localRaw)
        const serverLines = normalizeConfig(serverRaw)
        const diff = diffConfigLines(localLines, serverLines)

        const result: NginxDriftResult = {
          status: diff.length === 0 ? 'ok' : 'drift',
          localPath,
          serverPath: enabledPath,
          localLines: localLines.length,
          serverLines: serverLines.length,
          diff,
        }

        driftCache.set(name, result)
        return void reply.send(result)
      } catch {
        driftCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
