import { describe, it, expect, vi, beforeEach } from 'vitest'

const readJsonl = vi.fn()
vi.mock('./jsonl.js', () => ({ readJsonl: (...a: unknown[]) => readJsonl(...a) }))

import { pairIncidents, incidentsLast7d, metricsLast24h, trendLast24h } from './email-context.js'

const NOW = 1_800_000_000_000
const rec = (event: 'down' | 'up', tSec: number) => ({ type: 'ssh' as const, projectName: 'p', event, t: tSec })

beforeEach(() => { readJsonl.mockReset() })

describe('pairIncidents', () => {
  it('pairs down/up and leaves an unmatched down ongoing', () => {
    const out = pairIncidents([rec('down', 100), rec('up', 160), rec('down', 400)])
    expect(out).toEqual([{ atMs: 100_000, durationMs: 60_000 }, { atMs: 400_000 }])
  })
})

describe('incidentsLast7d', () => {
  it('returns paired incidents with a cause', async () => {
    readJsonl.mockResolvedValue([rec('down', 100), rec('up', 160)])
    const out = await incidentsLast7d('p', 'ssh', NOW)
    expect(out).toEqual([{ atMs: 100_000, durationMs: 60_000, cause: 'SSH unreachable' }])
  })

  it('returns empty when the file is unreadable', async () => {
    readJsonl.mockImplementation(() => { throw new Error('EACCES') })
    expect(await incidentsLast7d('p', 'http', NOW)).toEqual([])
  })

  it('returns empty when the file is missing', async () => {
    readJsonl.mockResolvedValue([])
    expect(await incidentsLast7d('p', 'http', NOW)).toEqual([])
  })
})

describe('metricsLast24h / trendLast24h', () => {
  it('returns the points read', async () => {
    readJsonl.mockResolvedValue([{ t: 1, disk: 50 }])
    expect(await metricsLast24h('p', NOW)).toHaveLength(1)
  })

  it('returns empty rather than throwing when unreadable', async () => {
    readJsonl.mockImplementation(() => { throw new Error('boom') })
    expect(await metricsLast24h('p', NOW)).toEqual([])
    expect(await trendLast24h('p', 'disk', NOW)).toBeUndefined()
  })

  it('computes a rising disk trend from history', async () => {
    const base = NOW / 1000 - 3600
    readJsonl.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ t: base + i * 300, disk: 50 + i })))
    const trend = await trendLast24h('p', 'disk', NOW)
    expect(trend?.pctPerDay).toBeGreaterThan(0)
  })

  it('is undefined with too little history', async () => {
    readJsonl.mockResolvedValue([{ t: 1, disk: 50 }])
    expect(await trendLast24h('p', 'disk', NOW)).toBeUndefined()
  })
})
