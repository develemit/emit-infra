import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDiskTrend } from './use-disk-trend'
import * as api from './api'

vi.mock('./api')

describe('useDiskTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null while loading', () => {
    vi.mocked(api.getDiskTrend).mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useDiskTrend('test-project'))

    expect(result.current).toBeNull()
  })

  it('returns a trend value when data loads', async () => {
    const mockTrend = { disk: 42, pctPerDay: 1.5, projectedDaysUntilFull: 100 }
    vi.mocked(api.getDiskTrend).mockResolvedValue(mockTrend)

    const { result } = renderHook(() => useDiskTrend('test-project'))

    await waitFor(() => {
      expect(result.current).toEqual(mockTrend)
    })
  })

  it('returns null when fetch fails', async () => {
    vi.mocked(api.getDiskTrend).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useDiskTrend('test-project'))

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })
})
