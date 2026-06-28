import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMemoryTrend } from './use-memory-trend'
import * as api from './api'

vi.mock('./api')

describe('useMemoryTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null while loading', () => {
    vi.mocked(api.getMemoryTrend).mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useMemoryTrend('test-project'))

    expect(result.current).toBeNull()
  })

  it('returns a trend value when data loads', async () => {
    const mockTrend = { mem: 60, pctPerDay: 2.0, projectedDaysUntilFull: 50 }
    vi.mocked(api.getMemoryTrend).mockResolvedValue(mockTrend)

    const { result } = renderHook(() => useMemoryTrend('test-project'))

    await waitFor(() => {
      expect(result.current).toEqual(mockTrend)
    })
  })

  it('returns null when fetch fails', async () => {
    vi.mocked(api.getMemoryTrend).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useMemoryTrend('test-project'))

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })
})
