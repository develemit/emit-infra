import { describe, it, expect, afterEach, vi } from 'vitest'
import { getAgentSessionId, setAgentSessionId, clearHistory } from './claude-session.js'

describe('claude-session', () => {
  describe('basic lifecycle', () => {
    it('stores a session and retrieves it', () => {
      setAgentSessionId('lifecycle-store-1', 'agent-id-abc')
      expect(getAgentSessionId('lifecycle-store-1')).toBe('agent-id-abc')
      clearHistory('lifecycle-store-1')
    })

    it('returns undefined for unknown session', () => {
      expect(getAgentSessionId('nonexistent-session-xyz-789')).toBeUndefined()
    })

    it('clearHistory removes a session', () => {
      setAgentSessionId('lifecycle-clear-1', 'agent-id-def')
      clearHistory('lifecycle-clear-1')
      expect(getAgentSessionId('lifecycle-clear-1')).toBeUndefined()
    })

    it('clearHistory on a nonexistent session is a no-op', () => {
      expect(() => clearHistory('never-existed-abc')).not.toThrow()
    })

    it('overwriting a session updates the stored agentSessionId', () => {
      setAgentSessionId('lifecycle-overwrite-1', 'agent-first')
      setAgentSessionId('lifecycle-overwrite-1', 'agent-second')
      expect(getAgentSessionId('lifecycle-overwrite-1')).toBe('agent-second')
      clearHistory('lifecycle-overwrite-1')
    })
  })

  describe('TTL expiry', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('session is accessible before 24h TTL expires', () => {
      vi.useFakeTimers({ now: new Date('2099-06-01T00:00:00Z') })
      setAgentSessionId('ttl-before-1', 'agent-ttl-before')
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1)
      expect(getAgentSessionId('ttl-before-1')).toBe('agent-ttl-before')
    })

    it('session returns undefined after 24h TTL expires', () => {
      vi.useFakeTimers({ now: new Date('2099-06-01T00:00:00Z') })
      setAgentSessionId('ttl-expired-1', 'agent-ttl-expired')
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1)
      expect(getAgentSessionId('ttl-expired-1')).toBeUndefined()
    })
  })

  describe('cap eviction', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('evicts the oldest session when the 100-session cap is exceeded', () => {
      // Set fake time far in the future so sweepExpired() clears all prior sessions
      // on the first setAgentSessionId call (real-time sessions expire relative to 2200)
      vi.useFakeTimers({ now: new Date('2200-01-01T00:00:00Z') })

      const ids = Array.from({ length: 101 }, (_, i) => `cap-evict-2200-${i}`) as string[]
      const oldest = ids[0] as string
      const newest = ids[100] as string

      // Fill to exactly 100 (sweepExpired runs on each insert, clearing old sessions)
      for (let i = 0; i < 100; i++) {
        setAgentSessionId(ids[i] as string, `agent-${i}`)
      }
      expect(getAgentSessionId(oldest)).toBe('agent-0')

      // 101st entry pushes size to 101 → oldest (ids[0]) is evicted
      setAgentSessionId(newest, 'agent-100')
      expect(getAgentSessionId(oldest)).toBeUndefined()
      expect(getAgentSessionId(newest)).toBe('agent-100')
    })
  })
})
