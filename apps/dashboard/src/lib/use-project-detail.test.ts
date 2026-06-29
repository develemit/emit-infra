import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProjectDetail } from './use-project-detail'

vi.mock('@/lib/api', () => ({
  getStatus: vi.fn(),
  getContainers: vi.fn(),
  getProjects: vi.fn(),
  getApiBase: vi.fn().mockReturnValue('http://localhost:7001'),
}))
vi.mock('@/lib/health', () => ({
  deriveHealth: vi.fn().mockReturnValue({ variant: 'ok' as const, label: 'OK' }),
}))
vi.mock('@/lib/metric-history', () => ({
  useMetricHistory: vi.fn().mockReturnValue([]),
  computeUptimePct: vi.fn().mockReturnValue(100),
}))
vi.mock('@/lib/use-server-metrics', () => ({
  useServerMetrics: vi.fn().mockReturnValue({ points: [] }),
}))
vi.mock('@/lib/use-deploy-markers', () => ({
  useDeployMarkers: vi.fn().mockReturnValue({ deploys: [] }),
}))
vi.mock('@/lib/use-ci-history', () => ({
  useCiHistory: vi.fn().mockReturnValue({ runs: [] }),
}))
vi.mock('@/lib/use-disk-trend', () => ({
  useDiskTrend: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/use-memory-trend', () => ({
  useMemoryTrend: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/use-backup-status', () => ({
  useBackupStatus: vi.fn().mockReturnValue(null),
}))

import * as api from '@/lib/api'

const mockStatus = { disk: 55, memory: 40, httpStatus: 200 as const, error: '' }

describe('useProjectDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with loading=true before fetch resolves', () => {
    vi.mocked(api.getStatus).mockImplementation(() => new Promise(() => {}))
    vi.mocked(api.getContainers).mockImplementation(() => new Promise(() => {}))
    vi.mocked(api.getProjects).mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useProjectDetail('myapp'))

    expect(result.current.loading).toBe(true)
    expect(result.current.status).toBeNull()
  })

  it('sets loading=false and populates status after fetch resolves', async () => {
    vi.mocked(api.getStatus).mockResolvedValue(mockStatus)
    vi.mocked(api.getContainers).mockResolvedValue([])
    vi.mocked(api.getProjects).mockResolvedValue([])

    const { result } = renderHook(() => useProjectDetail('myapp'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.status).toEqual(mockStatus)
  })

  it('exposes fetchData that triggers re-fetch', async () => {
    vi.mocked(api.getStatus).mockResolvedValue(mockStatus)
    vi.mocked(api.getContainers).mockResolvedValue([])
    vi.mocked(api.getProjects).mockResolvedValue([])

    const { result } = renderHook(() => useProjectDetail('myapp'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.fetchData()
    })

    expect(api.getStatus).toHaveBeenCalledTimes(2)
  })

  it('derives deployUrl from apiBase and project name', async () => {
    vi.mocked(api.getStatus).mockResolvedValue(mockStatus)
    vi.mocked(api.getContainers).mockResolvedValue([])
    vi.mocked(api.getProjects).mockResolvedValue([])

    const { result } = renderHook(() => useProjectDetail('my-app'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.deployUrl).toBe('http://localhost:7001/projects/my-app/deploy')
  })
})
