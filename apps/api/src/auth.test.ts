import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const API_SECRET = 'test-secret-xyz'

function makeAuthApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url === '/health') return
    const tokenParam = (req.query as Record<string, string | undefined>)['token']
    const auth = req.headers['authorization'] ?? (tokenParam ? `Bearer ${tokenParam}` : undefined)
    if (auth !== `Bearer ${API_SECRET}`) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
  })
  app.get('/protected', async () => ({ ok: true }))
  app.get('/health', async () => ({ ok: true }))
  return app
}

describe('API auth middleware', () => {
  it('accepts Authorization: Bearer header', async () => {
    const app = makeAuthApp()
    await app.ready()
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { Authorization: `Bearer ${API_SECRET}` },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('accepts ?token= query param (SSE fallback)', async () => {
    const app = makeAuthApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/protected?token=${API_SECRET}` })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('rejects requests with no auth', async () => {
    const app = makeAuthApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('rejects requests with wrong token', async () => {
    const app = makeAuthApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/protected?token=wrong' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('bypasses auth for /health route', async () => {
    const app = makeAuthApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
