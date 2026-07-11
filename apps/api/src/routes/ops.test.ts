import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  tool: vi.fn(),
  createSdkMcpServer: vi.fn().mockReturnValue({}),
}))

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('../lib/claude-session.js', () => ({
  getAgentSessionId: vi.fn().mockReturnValue(undefined),
  setAgentSessionId: vi.fn(),
  clearHistory: vi.fn(),
}))

vi.mock('../lib/tool-executor.js', () => ({
  executeTool: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  runAnsible: vi.fn(),
  runTerraform: vi.fn(),
}))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { discoverProjects } from '../lib/discover-projects.js'
import { clearHistory } from '../lib/claude-session.js'
import { opsRoutes } from './ops.js'
import { registerAuth } from '../lib/auth.js'

const mockQuery = vi.mocked(query)
const mockDiscoverProjects = vi.mocked(discoverProjects)
const mockClearHistory = vi.mocked(clearHistory)

const SECRET = 'test-ops-secret-abc'

function setupDefaultQueryMock(): void {
  mockQuery.mockImplementation(
    () =>
      ({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'system', subtype: 'init', session_id: 'mock-sdk-session' }
          yield { result: 'Hello from mock agent' }
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  )
}

describe('ops routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    setupDefaultQueryMock()
    mockDiscoverProjects.mockResolvedValue([])
    app = Fastify({ logger: false })
    await app.register(opsRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /ops/session', () => {
    it('returns a sessionId string', async () => {
      const res = await app.inject({ method: 'GET', url: '/ops/session' })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ sessionId: string }>()
      expect(typeof body.sessionId).toBe('string')
      expect(body.sessionId.length).toBeGreaterThan(0)
    })

    it('returns a different sessionId on each call', async () => {
      const res1 = await app.inject({ method: 'GET', url: '/ops/session' })
      const res2 = await app.inject({ method: 'GET', url: '/ops/session' })
      expect(res1.json<{ sessionId: string }>().sessionId).not.toBe(
        res2.json<{ sessionId: string }>().sessionId,
      )
    })
  })

  describe('DELETE /ops/session/:id', () => {
    it('returns { ok: true }', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/ops/session/some-session-id' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })

    it('calls clearHistory with the session id', async () => {
      await app.inject({ method: 'DELETE', url: '/ops/session/my-session-123' })
      expect(mockClearHistory).toHaveBeenCalledWith('my-session-123')
    })

    it('does not 500 when deleting a nonexistent session', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/ops/session/nonexistent-xyz' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })
  })

  describe('POST /ops/chat', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ops/chat',
        headers: { 'Content-Type': 'application/json' },
        payload: 'not valid json{',
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 200 with agent reply for valid chat body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ops/chat',
        payload: { sessionId: 'test-session', message: 'hello' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ reply: string; pendingConfirmation: unknown; toolResults: unknown[] }>()
      expect(body.reply).toBe('Hello from mock agent')
      expect(body.toolResults).toEqual([])
    })

    it('returns 503 when agent SDK throws', async () => {
      mockQuery.mockImplementation(() => {
        throw new Error('API key invalid')
      })
      const res = await app.inject({
        method: 'POST',
        url: '/ops/chat',
        payload: { sessionId: 'test-session', message: 'hello' },
      })
      expect(res.statusCode).toBe(503)
      expect(res.json<{ error: string }>().error).toContain('API key invalid')
    })

    it('returns 200 for unknown session (starts fresh conversation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ops/chat',
        payload: { sessionId: 'totally-unknown-session', message: 'test' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveProperty('reply')
    })
  })

  describe('auth', () => {
    let authApp: FastifyInstance

    beforeEach(async () => {
      authApp = Fastify({ logger: false })
      registerAuth(authApp, SECRET)
      await authApp.register(opsRoutes)
      await authApp.ready()
    })

    afterEach(async () => {
      await authApp.close()
    })

    it('GET /ops/session rejects unauthenticated request', async () => {
      const res = await authApp.inject({ method: 'GET', url: '/ops/session' })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    })

    it('GET /ops/session passes with valid Bearer token', async () => {
      const res = await authApp.inject({
        method: 'GET',
        url: '/ops/session',
        headers: { Authorization: `Bearer ${SECRET}` },
      })
      expect(res.statusCode).toBe(200)
    })

    it('DELETE /ops/session/:id rejects unauthenticated request', async () => {
      const res = await authApp.inject({ method: 'DELETE', url: '/ops/session/some-id' })
      expect(res.statusCode).toBe(401)
    })

    it('POST /ops/chat rejects unauthenticated request', async () => {
      const res = await authApp.inject({
        method: 'POST',
        url: '/ops/chat',
        payload: { sessionId: 'test', message: 'hi' },
      })
      expect(res.statusCode).toBe(401)
    })
  })
})
