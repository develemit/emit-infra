import { describe, it, expect } from 'vitest'
import { fetchResult, FETCH_ERROR_MESSAGES } from './fetch-result'

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

describe('fetchResult', () => {
  it('returns ok data on a 200', async () => {
    const result = await fetchResult<{ value: number }>(mockResponse(200, { value: 42 }))
    expect(result).toEqual({ ok: true, data: { value: 42 } })
  })

  it('maps a 503 to unreachable', async () => {
    const result = await fetchResult(mockResponse(503, { error: 'unreachable' }))
    expect(result).toEqual({ ok: false, kind: 'unreachable', message: FETCH_ERROR_MESSAGES.unreachable })
  })

  it('maps a 404 with a "not configured" body to not-configured', async () => {
    const result = await fetchResult(mockResponse(404, { error: 'postgres not configured' }))
    expect(result).toEqual({ ok: false, kind: 'not-configured', message: FETCH_ERROR_MESSAGES['not-configured'] })
  })

  it('maps a plain 404 to a generic error, not not-configured', async () => {
    const result = await fetchResult(mockResponse(404, { error: 'not found' }))
    expect(result).toEqual({ ok: false, kind: 'error', message: 'not found' })
  })

  it('maps other error statuses to a generic error using the body message', async () => {
    const result = await fetchResult(mockResponse(500, { error: 'boom' }))
    expect(result).toEqual({ ok: false, kind: 'error', message: 'boom' })
  })

  it('falls back to the default error message when the body has no error field', async () => {
    const result = await fetchResult(mockResponse(500, {}))
    expect(result).toEqual({ ok: false, kind: 'error', message: FETCH_ERROR_MESSAGES.error })
  })

  it('maps a rejected fetch promise (network failure) to unreachable', async () => {
    const result = await fetchResult(Promise.reject(new Error('network down')))
    expect(result).toEqual({ ok: false, kind: 'unreachable', message: FETCH_ERROR_MESSAGES.unreachable })
  })
})
