import { describe, it, expect } from 'vitest'
import { phaseSegments, formatPhaseSummary } from './deploy-phases'

describe('phaseSegments', () => {
  it('returns empty array when phases is absent', () => {
    expect(phaseSegments(undefined)).toEqual([])
  })

  it('returns empty array when all phases are zero', () => {
    expect(phaseSegments({ ci: 0, build: 0 })).toEqual([])
  })

  it('orders segments by the canonical phase order, not object key order', () => {
    const segments = phaseSegments({ deploy: 40, ci: 88, build: 297 })
    expect(segments.map(s => s.key)).toEqual(['ci', 'build', 'deploy'])
  })

  it('omits phases missing from the object', () => {
    const segments = phaseSegments({ ci: 20, build: 68, deploy: 122 })
    expect(segments.map(s => s.key)).toEqual(['ci', 'build', 'deploy'])
  })

  it('omits zero-second phases while keeping others', () => {
    const segments = phaseSegments({ ci: 20, auth: 0, build: 68 })
    expect(segments.map(s => s.key)).toEqual(['ci', 'build'])
  })

  it('computes percentage of total for each phase', () => {
    const segments = phaseSegments({ ci: 25, build: 75 })
    expect(segments.find(s => s.key === 'ci')?.pct).toBeCloseTo(25)
    expect(segments.find(s => s.key === 'build')?.pct).toBeCloseTo(75)
  })

  it('handles a single dominant phase as ~100%', () => {
    const segments = phaseSegments({ ci: 1, deploy: 1400 })
    expect(segments.find(s => s.key === 'deploy')?.pct).toBeGreaterThan(99)
  })

  it('labels preDeploy with a hyphen for display', () => {
    const segments = phaseSegments({ preDeploy: 5 })
    expect(segments[0]?.label).toBe('pre-deploy')
  })

  it('handles the full six-phase set', () => {
    const segments = phaseSegments({ ci: 1, auth: 1, build: 1, retag: 1, preDeploy: 1, deploy: 1 })
    expect(segments.map(s => s.key)).toEqual(['ci', 'auth', 'build', 'retag', 'preDeploy', 'deploy'])
    segments.forEach(s => expect(s.pct).toBeCloseTo(100 / 6))
  })
})

describe('formatPhaseSummary', () => {
  it('joins segments with a middle dot', () => {
    const segments = phaseSegments({ ci: 88, build: 297, deploy: 40 })
    expect(formatPhaseSummary(segments)).toBe('ci 88s · build 297s · deploy 40s')
  })

  it('returns an empty string for no segments', () => {
    expect(formatPhaseSummary([])).toBe('')
  })
})
