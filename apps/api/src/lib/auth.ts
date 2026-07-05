import type { FastifyInstance } from 'fastify'

export function registerAuth(app: FastifyInstance, secret: string | undefined): void {
  if (!secret) return
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url === '/health') return
    const tokenParam = (req.query as Record<string, string | undefined>)['token']
    const auth = req.headers['authorization'] ?? (tokenParam ? `Bearer ${tokenParam}` : undefined)
    if (auth !== `Bearer ${secret}`) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
  })
}
