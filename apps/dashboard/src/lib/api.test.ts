import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getStatus } from './api'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('getStatus', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns status data on 200', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { uptime: 'up 3 days', disk: 42, memory: 60, containerCount: 2 }))

    const result = await getStatus('myapp')

    expect(result.uptime).toBe('up 3 days')
    expect(result.disk).toBe(42)
    expect(result.memory).toBe(60)
    expect(result.containerCount).toBe(2)
  })

  it('returns error body on 503 instead of throwing', async () => {
    vi.stubGlobal('fetch', mockFetch(503, { error: 'unreachable' }))

    const result = await getStatus('myapp')

    expect(result).toEqual({ error: 'unreachable' })
  })

  it('throws on non-ok status other than 503', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'not found' }))

    await expect(getStatus('myapp')).rejects.toThrow('API error 404')
  })
})
