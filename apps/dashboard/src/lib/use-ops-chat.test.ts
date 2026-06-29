import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useOpsChat } from './use-ops-chat'

vi.mock('@/lib/api', () => ({
  getApiBase: vi.fn().mockReturnValue('http://localhost:7001'),
  getStatus: vi.fn().mockRejectedValue(new Error('not needed')),
  getProjects: vi.fn().mockRejectedValue(new Error('not needed')),
  getDeployHistory: vi.fn().mockRejectedValue(new Error('not needed')),
  getCiHistory: vi.fn().mockRejectedValue(new Error('not needed')),
}))

function mockFetch(response: object) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve(response),
  })
}

describe('useOpsChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches a session ID on mount', async () => {
    const fetchMock = mockFetch({ sessionId: 'sess-abc' })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useOpsChat(null))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/ops/session'),
      )
    })

    vi.unstubAllGlobals()
    // session ID is internal state; test that fetch was called (session init)
    expect(result.current.messages).toHaveLength(0)
  })

  it('submit appends user and claude messages', async () => {
    let callCount = 0
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/ops/session') && callCount++ === 0) {
        return Promise.resolve({ json: () => Promise.resolve({ sessionId: 'sess-1' }) })
      }
      return Promise.resolve({
        json: () => Promise.resolve({ reply: 'Hello from Claude', toolResults: null, pendingConfirmation: null }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useOpsChat(null))
    // wait for session
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current.submit('Hello')
    })

    expect(result.current.messages.some(m => m.type === 'user' && m.text === 'Hello')).toBe(true)
    expect(result.current.messages.some(m => m.type === 'claude' && m.text === 'Hello from Claude')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('clearContext sets contextProject and statusContext to null', async () => {
    const fetchMock = mockFetch({ sessionId: 'sess-2' })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useOpsChat('myapp'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(result.current.contextProject).toBe('myapp')

    act(() => {
      result.current.clearContext()
    })

    expect(result.current.contextProject).toBeNull()
    expect(result.current.statusContext).toBeNull()
    vi.unstubAllGlobals()
  })

  it('handleNewConversation deletes old session and creates new one', async () => {
    let callCount = 0
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      callCount++
      if (String(url).includes('/ops/session') && (!opts || opts.method !== 'DELETE')) {
        return Promise.resolve({ json: () => Promise.resolve({ sessionId: `sess-${callCount}` }) })
      }
      return Promise.resolve({ json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useOpsChat(null))
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1))

    await act(async () => {
      await result.current.handleNewConversation()
    })

    expect(result.current.messages).toHaveLength(0)
    expect(result.current.resetting).toBe(false)
    vi.unstubAllGlobals()
  })
})
