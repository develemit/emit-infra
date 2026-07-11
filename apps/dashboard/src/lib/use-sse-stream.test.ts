import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSseStream } from './use-sse-stream'

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
      controller.close()
    },
  })
}

function mockFetch(stream: ReadableStream<Uint8Array>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ body: stream } as Response))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSseStream', () => {
  it('does not fetch when enabled is false', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderHook(() => useSseStream('http://x', { enabled: false, onEvent: vi.fn() }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not fetch when url is empty', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderHook(() => useSseStream('', { onEvent: vi.fn() }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('dispatches events from a single chunk', async () => {
    const chunk =
      'data: {"type":"line","stream":"stdout","text":"hello"}\n\n' +
      'data: {"type":"done","exitCode":0}\n\n'
    mockFetch(makeStream([chunk]))
    const onEvent = vi.fn()
    renderHook(() => useSseStream<SseEvent>('http://x', { onEvent }))
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2))
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'line', stream: 'stdout', text: 'hello' })
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: 'done', exitCode: 0 })
  })

  it('handles a frame split across two chunks', async () => {
    const chunk1 = 'data: {"type":"line","stream":"stdout","text":"split"}\n'
    const chunk2 = '\ndata: {"type":"done","exitCode":0}\n\n'
    mockFetch(makeStream([chunk1, chunk2]))
    const onEvent = vi.fn()
    renderHook(() => useSseStream<SseEvent>('http://x', { onEvent }))
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2))
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'line', stream: 'stdout', text: 'split' })
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: 'done', exitCode: 0 })
  })

  it('skips malformed frames and continues parsing', async () => {
    const chunk = 'data: not-json\n\ndata: {"type":"done","exitCode":0}\n\n'
    mockFetch(makeStream([chunk]))
    const onEvent = vi.fn()
    renderHook(() => useSseStream<SseEvent>('http://x', { onEvent }))
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith({ type: 'done', exitCode: 0 })
  })

  it('ignores non-data lines in a frame', async () => {
    const chunk = 'event: update\ndata: {"type":"done","exitCode":0}\n\n'
    mockFetch(makeStream([chunk]))
    const onEvent = vi.fn()
    renderHook(() => useSseStream<SseEvent>('http://x', { onEvent }))
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith({ type: 'done', exitCode: 0 })
  })

  it('aborts the request on unmount', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const { unmount } = renderHook(() => useSseStream('http://x', { onEvent: vi.fn() }))
    unmount()
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!
    expect(signal.aborted).toBe(true)
  })

  it('passes method, headers, and body to fetch', async () => {
    mockFetch(makeStream([]))
    renderHook(() =>
      useSseStream('http://x', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok' },
        body: undefined,
        onEvent: vi.fn(),
      })
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('http://x')
    expect((init as RequestInit).method).toBe('GET')
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer tok' })
  })
})
