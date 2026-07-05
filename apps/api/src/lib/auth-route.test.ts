import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerAuth } from './auth.js'

const SECRET = 'test-secret-abc'

describe('route-level auth coverage', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify({ logger: false })
    registerAuth(app, SECRET)
    app.get('/projects/test', async () => ({ ok: true }))
    app.get('/health', async () => ({ ok: true }))
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/test' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 200 with Authorization: Bearer header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/projects/test',
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('returns 200 with ?token= query param', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/test?token=${SECRET}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('bypasses auth for /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('does not register hook when secret is undefined', async () => {
    const noAuthApp = Fastify({ logger: false })
    registerAuth(noAuthApp, undefined)
    noAuthApp.get('/open', async () => ({ ok: true }))
    await noAuthApp.ready()
    const res = await noAuthApp.inject({ method: 'GET', url: '/open' })
    expect(res.statusCode).toBe(200)
    await noAuthApp.close()
  })
})
