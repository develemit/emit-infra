import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { getPublicKey, addSubscription, listSubscriptions, removeSubscription, sendToAll } from '../lib/push.js'

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

  // Manual test endpoint — fire a push to all registered devices.
  app.post('/push/notify', async (req, reply) => {
    const parsed = NotifyBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message })
    const result = await sendToAll({
      title: parsed.data.title,
      body: parsed.data.body,
      ...(parsed.data.url !== undefined && { url: parsed.data.url }),
      ...(parsed.data.tag !== undefined && { tag: parsed.data.tag }),
    })
    return { ok: true, ...result }
  })
}
