import { describe, it, expect } from 'vitest'
import { buildDigest } from './weekly-digest.js'

describe('buildDigest', () => {
  const nd = { diskPctNow: undefined, diskPctWeekAgo: undefined }

  it('returns zero counts for empty projects list', () => {
    const result = buildDigest([])
    expect(result.incidentCount).toBe(0)
    expect(result.deployCount).toBe(0)
    expect(result.diskDeltas).toEqual([])
  })

  it('counts non-false-positive incidents', () => {
    const result = buildDigest([{
      project: 'myapp',
      incidents: [{ falsePositive: false }, { falsePositive: true }, {}],
      deploys: [],
      ...nd,
    }])
    expect(result.incidentCount).toBe(2)
  })

  it('counts deploys', () => {
    const result = buildDigest([{
      project: 'myapp', incidents: [], deploys: [{}, {}, {}], ...nd,
    }])
    expect(result.deployCount).toBe(3)
  })

  it('aggregates across multiple projects', () => {
    const result = buildDigest([
      { project: 'a', incidents: [{}], deploys: [{}, {}], ...nd },
      { project: 'b', incidents: [{}, {}], deploys: [{}], ...nd },
    ])
    expect(result.incidentCount).toBe(3)
    expect(result.deployCount).toBe(3)
  })

  it('formats summary with singular incident and plural deploys', () => {
    const result = buildDigest([{ project: 'a', incidents: [{}], deploys: [{}, {}], ...nd }])
    expect(result.summaryLine).toBe('This week: 1 incident, 2 deploys')
  })

  it('formats summary with plural incidents and singular deploy', () => {
    const result = buildDigest([{ project: 'a', incidents: [{}, {}], deploys: [{}], ...nd }])
    expect(result.summaryLine).toBe('This week: 2 incidents, 1 deploy')
  })

  it('formats zero incident and deploy week', () => {
    const result = buildDigest([])
    expect(result.summaryLine).toBe('This week: 0 incidents, 0 deploys')
  })

  it('includes disk growth in summary when data is available', () => {
    const result = buildDigest([{
      project: 'emit-vision', incidents: [], deploys: [], diskPctNow: 69, diskPctWeekAgo: 60,
    }])
    expect(result.summaryLine).toContain('disk +9% on emit-vision')
  })

  it('includes disk shrink with negative sign', () => {
    const result = buildDigest([{
      project: 'myapp', incidents: [], deploys: [], diskPctNow: 40, diskPctWeekAgo: 50,
    }])
    expect(result.summaryLine).toContain('disk -10% on myapp')
  })

  it('omits disk info when disk data is missing', () => {
    const result = buildDigest([{ project: 'a', incidents: [], deploys: [], ...nd }])
    expect(result.summaryLine).not.toContain('disk')
  })

  it('omits disk info when delta is zero', () => {
    const result = buildDigest([{
      project: 'a', incidents: [], deploys: [], diskPctNow: 50, diskPctWeekAgo: 50,
    }])
    expect(result.summaryLine).not.toContain('disk')
  })

  it('picks the project with largest absolute disk delta', () => {
    const result = buildDigest([
      { project: 'big', incidents: [], deploys: [], diskPctNow: 80, diskPctWeekAgo: 60 },
      { project: 'small', incidents: [], deploys: [], diskPctNow: 50, diskPctWeekAgo: 45 },
    ])
    expect(result.diskDeltas[0]?.project).toBe('big')
    expect(result.summaryLine).toContain('disk +20% on big')
  })

  it('rounds disk delta to nearest integer', () => {
    const result = buildDigest([{
      project: 'a', incidents: [], deploys: [], diskPctNow: 60.3, diskPctWeekAgo: 55.0,
    }])
    expect(result.diskDeltas[0]?.deltaPct).toBe(5)
  })
})
