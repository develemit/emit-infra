import { describe, it, expect } from 'vitest'
import { deriveHealth, fleetStatusSummary } from './health'
import type { ProjectStatus } from './api'

describe('deriveHealth', () => {
  it('reports Loading when status is null', () => {
    expect(deriveHealth(null)).toEqual({ variant: 'muted', label: 'Loading' })
  })

  it('reports Down when the site is unreachable', () => {
    const status = { error: 'unreachable' } as unknown as ProjectStatus
    expect(deriveHealth(status)).toEqual({ variant: 'err', label: 'Unreachable' })
  })

  it('reports Healthy for a clean status', () => {
    const status = { disk: 10, memory: 10, httpStatus: 200 } as unknown as ProjectStatus
    expect(deriveHealth(status)).toEqual({ variant: 'ok', label: 'Healthy' })
  })
})

describe('fleetStatusSummary', () => {
  it('is not loaded until every project has a resolved status', () => {
    const names = ['a', 'b', 'c']
    const statuses = { a: {} as ProjectStatus } // b, c still pending
    const summary = fleetStatusSummary(names, statuses)
    expect(summary.loaded).toBe(false)
    expect(summary.healthy).toBe(0)
  })

  it('reports the true healthy count once every status has settled', () => {
    const names = ['a', 'b', 'c']
    const statuses: Record<string, ProjectStatus> = {
      a: {} as ProjectStatus,
      b: { error: 'unreachable' } as unknown as ProjectStatus,
      c: {} as ProjectStatus,
    }
    const summary = fleetStatusSummary(names, statuses)
    expect(summary).toEqual({ loaded: true, healthy: 2, total: 3, color: '#f59e0b' })
  })

  it('colors all-healthy fleets green and all-down fleets red', () => {
    const allHealthy = fleetStatusSummary(['a'], { a: {} as ProjectStatus })
    expect(allHealthy.color).toBe('var(--ok, #22c55e)')

    const allDown = fleetStatusSummary(['a'], { a: { error: 'unreachable' } as unknown as ProjectStatus })
    expect(allDown.color).toBe('var(--err)')
  })
})
