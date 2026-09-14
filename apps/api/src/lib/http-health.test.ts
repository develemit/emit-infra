import { describe, it, expect } from 'vitest'
import {
  stepHealth, seedHealthState, causeText, formatDuration, initialHealthState,
  DOWN_THRESHOLD, UP_THRESHOLD, FIRST_REMINDER_MS, REMINDER_INTERVAL_MS,
  type HealthState, type HealthEvent, type ProbeResult,
} from './http-health.js'

const MIN = 60_000
const HOUR = 60 * MIN

function replay(results: ProbeResult[], startMs: number): { state: HealthState; events: HealthEvent[] }[] {
  let state = initialHealthState
  return results.map((result, i) => {
    const step = stepHealth(state, result, startMs + i * MIN)
    state = step.state
    return step
  })
}

describe('stepHealth', () => {
  it('does not declare down until DOWN_THRESHOLD consecutive failures', () => {
    const steps = replay([{ ok: false }, { ok: false }], 0)
    expect(steps.flatMap(s => s.events)).toEqual([])
    expect(steps.at(-1)!.state.status).toBe('unknown')
  })

  it('declares down on the Nth consecutive failure', () => {
    const results = Array.from({ length: DOWN_THRESHOLD }, () => ({ ok: false, status: 526 }))
    const steps = replay(results, 0)
    const events = steps.flatMap(s => s.events)
    expect(events).toEqual([{ kind: 'down', status: 526 }])
    expect(steps.at(-1)!.state.status).toBe('down')
  })

  it('declares recovered only after UP_THRESHOLD consecutive successes', () => {
    let state: HealthState = { ...initialHealthState, status: 'down', consecutiveFails: DOWN_THRESHOLD, downSinceMs: 0 }
    let events: HealthEvent[] = []
    for (let i = 0; i < UP_THRESHOLD; i++) {
      const step = stepHealth(state, { ok: true }, (i + 1) * MIN)
      state = step.state
      events = events.concat(step.events)
      if (i < UP_THRESHOLD - 1) expect(step.events).toEqual([])
    }
    expect(events).toEqual([{ kind: 'up', downDurationMs: UP_THRESHOLD * MIN }])
    expect(state.status).toBe('up')
  })

  // Reconstructed from the diner-decider .incidents.jsonl transition log
  // (sprint 334's Reason section): the origin's own nginx access log shows
  // 100% success for every request in this window, so the "up" blips were
  // Cloudflare accepting pooled/keepalive connections opened before the cert
  // expired at 15:49:54Z, not the origin actually recovering. Reconstructed
  // as one poll per logged transition boundary (POLL_MS = 60s).
  it('replaying the diner-decider incident sequence yields one down notification, not four', () => {
    const fail = { ok: false, status: 526 }
    const ok = { ok: true, status: 200 }
    const results: ProbeResult[] = [
      fail,                          // 16:11 down
      ok,                            // 16:12 up (1 poll)
      fail, fail,                    // 16:13-16:14 down (2 polls, never reaches threshold)
      ok, ok, ok, ok, ok, ok, ok, ok, // 16:15-16:22 up (8 polls)
      fail,                          // 16:23 down (1 poll)
      ok, ok,                        // 16:24-16:25 up (2 polls)
      fail, fail, fail,              // 16:26-16:28 down — this is the real outage, crosses threshold
    ]
    const steps = replay(results, 0)
    const downEvents = steps.flatMap(s => s.events).filter(e => e.kind === 'down')
    expect(downEvents).toEqual([{ kind: 'down', status: 526 }])
  })

  it('emits a reminder at 1 hour, then every 6 hours while down', () => {
    let state: HealthState = { ...initialHealthState, status: 'down', consecutiveFails: DOWN_THRESHOLD, downSinceMs: 0 }
    const reminderTimes: number[] = []
    // Poll every 10 minutes across 26 hours, like the actual diner-decider gap.
    for (let t = 10 * MIN; t <= 26 * HOUR; t += 10 * MIN) {
      const step = stepHealth(state, { ok: false, status: 526 }, t)
      state = step.state
      for (const event of step.events) {
        if (event.kind === 'reminder') reminderTimes.push(t)
      }
    }
    expect(reminderTimes[0]).toBe(FIRST_REMINDER_MS)
    expect(reminderTimes[1]! - reminderTimes[0]!).toBe(REMINDER_INTERVAL_MS)
    expect(reminderTimes[2]! - reminderTimes[1]!).toBe(REMINDER_INTERVAL_MS)
  })

  it('reminder body includes how long the site has been down', () => {
    const state: HealthState = { ...initialHealthState, status: 'down', consecutiveFails: DOWN_THRESHOLD, downSinceMs: 0 }
    const step = stepHealth(state, { ok: false, status: 526 }, FIRST_REMINDER_MS)
    expect(step.events).toEqual([{ kind: 'reminder', status: 526, downDurationMs: FIRST_REMINDER_MS }])
  })
})

describe('causeText', () => {
  it('names the Cloudflare cause for known edge status codes', () => {
    expect(causeText(526)).toBe('origin TLS certificate invalid or expired')
    expect(causeText(525)).toBe('TLS handshake with origin failed')
    expect(causeText(522)).toBe('origin connection timed out')
    expect(causeText(521)).toBe('origin refused the connection')
    expect(causeText(502)).toBe('bad gateway')
    expect(causeText(504)).toBe('gateway timeout')
  })

  it('falls back to a generic label for unmapped statuses', () => {
    expect(causeText(500)).toBe('HTTP 500 from origin')
  })

  it('describes no response when there is no status at all', () => {
    expect(causeText(undefined)).toBe('no response from the health check')
  })
})

describe('formatDuration', () => {
  it('formats minutes, hours, and days', () => {
    expect(formatDuration(5 * MIN)).toBe('5m')
    expect(formatDuration(90 * MIN)).toBe('1h 30m')
    expect(formatDuration(26 * HOUR)).toBe('1d 2h')
  })
})

describe('seedHealthState', () => {
  it('seeds unknown when there is no prior incident', () => {
    expect(seedHealthState(undefined, 0)).toEqual(initialHealthState)
  })

  it('seeds up state from a last "up" event', () => {
    const state = seedHealthState({ event: 'up', t: 1000 }, 2_000_000)
    expect(state.status).toBe('up')
    expect(state.consecutiveOks).toBe(UP_THRESHOLD)
  })

  it('seeds down state with downSince from a last "down" event, so a restart mid-outage still reminds and recovers', () => {
    const downSinceSec = 1_000
    const nowMs = downSinceSec * 1000 + 2 * HOUR
    const state = seedHealthState({ event: 'down', t: downSinceSec }, nowMs)
    expect(state.status).toBe('down')
    expect(state.consecutiveFails).toBe(DOWN_THRESHOLD)
    expect(state.downSinceMs).toBe(downSinceSec * 1000)

    // A poll right after restart should immediately fire a reminder, since
    // the outage has already run past the 1-hour mark.
    const step = stepHealth(state, { ok: false, status: 526 }, nowMs)
    expect(step.events).toEqual([{ kind: 'reminder', status: 526, downDurationMs: nowMs - state.downSinceMs! }])

    // And recovering still fires the "up" notification, not silence.
    let recovered = step.state
    let upEvent: HealthEvent | undefined
    for (let i = 0; i < UP_THRESHOLD; i++) {
      const s = stepHealth(recovered, { ok: true }, nowMs + (i + 1) * MIN)
      recovered = s.state
      upEvent = s.events.find(e => e.kind === 'up') ?? upEvent
    }
    expect(upEvent).toBeDefined()
    expect(recovered.status).toBe('up')
  })
})
