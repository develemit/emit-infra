import type Anthropic from '@anthropic-ai/sdk'

const sessions = new Map<string, Anthropic.MessageParam[]>()

export function getHistory(sessionId: string): Anthropic.MessageParam[] {
  return [...(sessions.get(sessionId) ?? [])]
}

export function appendMessage(sessionId: string, message: Anthropic.MessageParam): void {
  const history = sessions.get(sessionId) ?? []
  history.push(message)
  sessions.set(sessionId, history)
}

export function clearHistory(sessionId: string): void {
  sessions.delete(sessionId)
}
