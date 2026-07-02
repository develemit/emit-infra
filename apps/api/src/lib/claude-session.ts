// Maps our session IDs → Agent SDK session IDs for conversation resumption.
// Bounded: entries expire after 24h and the map is capped at 100 sessions
// (oldest evicted) so the long-lived API process can't leak memory here.
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 100

interface SessionEntry {
  agentSessionId: string
  expiresAt: number
}

const sessions = new Map<string, SessionEntry>()

function sweepExpired(): void {
  const now = Date.now()
  for (const [key, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(key)
  }
}

export function getAgentSessionId(sessionId: string): string | undefined {
  const entry = sessions.get(sessionId)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId)
    return undefined
  }
  return entry.agentSessionId
}

export function setAgentSessionId(sessionId: string, agentSessionId: string): void {
  sweepExpired()
  sessions.delete(sessionId)
  sessions.set(sessionId, { agentSessionId, expiresAt: Date.now() + TTL_MS })
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest !== undefined) sessions.delete(oldest)
  }
}

export function clearHistory(sessionId: string): void {
  sessions.delete(sessionId)
}
