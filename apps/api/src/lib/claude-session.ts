// Maps our session IDs → Agent SDK session IDs for conversation resumption
const sessions = new Map<string, string>()

export function getAgentSessionId(sessionId: string): string | undefined {
  return sessions.get(sessionId)
}

export function setAgentSessionId(sessionId: string, agentSessionId: string): void {
  sessions.set(sessionId, agentSessionId)
}

export function clearHistory(sessionId: string): void {
  sessions.delete(sessionId)
}
