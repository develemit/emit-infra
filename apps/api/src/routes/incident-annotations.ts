import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { SAFE_NAME_RE } from '../lib/project-helpers.js'
import { findProject } from '../lib/project-helpers.js'
import { readAnnotations, writeAnnotation } from '../lib/annotations.js'

const NameParam = z.object({ name: z.string().regex(SAFE_NAME_RE) })
const StartedAtParam = z.object({
  name: z.string().regex(SAFE_NAME_RE),
  startedAt: z.coerce.number().int().min(0),
})
const AnnotationBody = z.object({
  note: z.string().max(500).optional(),
  falsePositive: z.boolean().optional(),
})

function annotationsPath(name: string): string {
  return join(homedir(), 'projects', name, '.incident-annotations.json')
}

export async function incidentAnnotationRoutes(app: FastifyInstance) {
  app.put(
    '/projects/:name/incidents/:startedAt/annotation',
    async (req, reply) => {
      const params = StartedAtParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: 'Invalid params' })

      const body = AnnotationBody.safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: 'Invalid body' })

      if (body.data.note === undefined && body.data.falsePositive === undefined) {
        return reply.status(400).send({ error: 'Provide note or falsePositive' })
      }

      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const filePath = annotationsPath(params.data.name)
      await writeAnnotation(filePath, String(params.data.startedAt), body.data)

      return reply.status(200).send({ ok: true })
    },
  )

  app.get(
    '/projects/:name/incident-annotations',
    async (req, reply) => {
      const params = NameParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: 'Invalid project name' })

      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const filePath = annotationsPath(params.data.name)
      const annotations = await readAnnotations(filePath)
      return annotations
    },
  )
}
