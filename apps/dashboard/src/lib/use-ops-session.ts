'use client'
import { useState, useEffect } from 'react'
import { getApiBase } from '@/lib/api-auth'

export function useOpsSession() {
  const apiBase = getApiBase()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/ops/session`)
      .then(r => r.json() as Promise<{ sessionId: string }>)
      .then(d => setSessionId(d.sessionId))
      .catch(console.error)
  }, [apiBase])

  async function resetSession(onClear?: () => void) {
    setResetting(true)
    try {
      if (sessionId) {
        await fetch(`${apiBase}/ops/session/${sessionId}`, { method: 'DELETE' }).catch(() => {})
      }
      onClear?.()
      try {
        const res = await fetch(`${apiBase}/ops/session`)
        const data = await res.json() as { sessionId: string }
        setSessionId(data.sessionId)
      } catch {
        // keep existing session id
      }
    } finally {
      setResetting(false)
    }
  }

  return { sessionId, resetting, resetSession }
}
