import { describe, it, expect } from 'vitest'
import { filterAlertEntries } from './prune-alerts.js'

const NOW_SEC = 1_000_000
const DAY = 86400
const cutoff = NOW_SEC - 90 * DAY

describe('filterAlertEntries', () => {
  it('keeps entries within 90 days (89 days old)', () => {
    const entry = JSON.stringify({ firedAt: NOW_SEC - 89 * DAY })
    expect(filterAlertEntries([entry], cutoff)).toHaveLength(1)
  })

  it('removes entries older than 90 days (91 days old)', () => {
    const entry = JSON.stringify({ firedAt: NOW_SEC - 91 * DAY })
    expect(filterAlertEntries([entry], cutoff)).toHaveLength(0)
  })

  it('keeps entries exactly at the cutoff boundary', () => {
    const entry = JSON.stringify({ firedAt: cutoff })
    expect(filterAlertEntries([entry], cutoff)).toHaveLength(1)
  })

  it('drops empty lines', () => {
    const entry = JSON.stringify({ firedAt: NOW_SEC - 10 * DAY })
    expect(filterAlertEntries(['', entry, ''], cutoff)).toHaveLength(1)
  })

  it('drops malformed JSON lines', () => {
    const valid = JSON.stringify({ firedAt: NOW_SEC - 10 * DAY })
    expect(filterAlertEntries(['{bad json}', valid], cutoff)).toHaveLength(1)
  })

  it('drops entries missing firedAt', () => {
    const entry = JSON.stringify({ metric: 'diskPct', value: 85 })
    expect(filterAlertEntries([entry], cutoff)).toHaveLength(0)
  })

  it('returns all lines when all are in range', () => {
    const entries = [
      JSON.stringify({ firedAt: NOW_SEC - 10 * DAY }),
      JSON.stringify({ firedAt: NOW_SEC - 30 * DAY }),
      JSON.stringify({ firedAt: NOW_SEC - 89 * DAY }),
    ]
    expect(filterAlertEntries(entries, cutoff)).toHaveLength(3)
  })

  it('returns empty array when all are out of range', () => {
    const entries = [
      JSON.stringify({ firedAt: NOW_SEC - 91 * DAY }),
      JSON.stringify({ firedAt: NOW_SEC - 200 * DAY }),
    ]
    expect(filterAlertEntries(entries, cutoff)).toHaveLength(0)
  })
})
