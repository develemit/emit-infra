import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pingPulse, pulseUrl } from './pulse.js'

describe('pingPulse', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    process.env.EMIT_VISION_INGEST_KEY = 'evk_test'
    fetchMock.mockReset().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    delete process.env.EMIT_VISION_INGEST_KEY
    vi.unstubAllGlobals()
  })

  it('hits the success URL with a bearer header', async () => {
    expect(await pingPulse('emit-infra-monitor')).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.emitvision.com/v1/pulse/emit-infra-monitor')
    expect(init.headers.Authorization).toBe('Bearer evk_test')
  })

  it('hits the /fail URL when fail is set', async () => {
    await pingPulse('emit-infra-monitor', { fail: true })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.emitvision.com/v1/pulse/emit-infra-monitor/fail')
  })

  it('appends an encoded release', () => {
    expect(pulseUrl('x', { release: 'a b' })).toBe('https://api.emitvision.com/v1/pulse/x?release=a%20b')
  })

  it('passes a 5s timeout signal', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    await pingPulse('x')
    expect(spy).toHaveBeenCalledWith(5_000)
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
  })

  it('does not throw on network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await pingPulse('x')).toBe(false)
  })

  it('returns false on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    expect(await pingPulse('x')).toBe(false)
  })

  it('is a no-op without the ingest key', async () => {
    delete process.env.EMIT_VISION_INGEST_KEY
    expect(await pingPulse('x')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
