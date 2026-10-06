import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { getPublicKey, addSubscription, listSubscriptions, removeSubscription } from '../lib/push.js'
import { notify } from '../lib/notify.js'
import { renderSample, SAMPLE_KINDS, type SampleKind } from '../lib/email-templates/fixtures.js'

const SubscriptionBody = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  label: z.string().max(60).optional(),
})

const DeleteBody = z.object({ endpoint: z.url() })

const NotifyBody = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
  url: z.string().min(1).max(2048).optional(),
  tag: z.string().min(1).max(60).optional(),
})

export async function pushRoutes(app: FastifyInstance) {
  app.get('/push/vapid', async () => {
    return { publicKey: getPublicKey() }
  })

  app.post('/push/subscribe', async (req, reply) => {
    const parsed = SubscriptionBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message })
    addSubscription({
      endpoint: parsed.data.endpoint,
      keys: parsed.data.keys,
      addedAtISO: new Date().toISOString(),
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
    })
    return { ok: true }
  })

  app.get('/push/subscribe', async () => {
    return {
      subscriptions: listSubscriptions().map((s) => ({
        endpoint: s.endpoint,
        label: s.label ?? null,
        addedAtISO: s.addedAtISO,
      })),
    }
  })

  app.delete('/push/subscribe', async (req, reply) => {
    const parsed = DeleteBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message })
    const removed = removeSubscription(parsed.data.endpoint)
    return { ok: removed }
  })

  // Manual test endpoint — fires through notify(), so it also sends an email.
  // `?sample=health|alert-rule|deploy|digest` sends that kind's fixture email.
  app.post('/push/notify', async (req, reply) => {
    const sample = (req.query as { sample?: string }).sample
    if (sample !== undefined) {
      if (!SAMPLE_KINDS.includes(sample as SampleKind)) return reply.status(400).send({ error: `sample must be one of ${SAMPLE_KINDS.join(', ')}` })
      const email = renderSample(sample as SampleKind)
      const result = await notify({ severity: 'info', email, title: email.subject, body: `Sample ${sample} email`, tag: `sample:${sample}` })
      return { ok: true, ...result.push, email: result.email }
    }
    const parsed = NotifyBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message })
    const result = await notify({
      severity: 'alert',
      title: parsed.data.title,
      body: parsed.data.body,
      ...(parsed.data.url !== undefined && { url: parsed.data.url }),
      ...(parsed.data.tag !== undefined && { tag: parsed.data.tag }),
    })
    return { ok: true, ...result.push, email: result.email }
  })
}
