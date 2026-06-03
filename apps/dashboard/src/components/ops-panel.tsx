'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Send } from 'lucide-react'
import { getApiBase } from '@/lib/api'
import { SseOutputPanel } from './sse-output-panel'
import { cn } from '@/lib/utils'

interface PendingConfirmation {
  toolName: string
  projectName: string
}

interface Message {
  role: 'user' | 'assistant' | 'tool'
  text: string
  toolName?: string
}

interface ChatResponse {
  reply: string
  pendingConfirmation?: PendingConfirmation
  toolResults?: Array<{ toolName: string; result: unknown }>
}

async function getSessionId(apiBase: string): Promise<string> {
  const res = await fetch(`${apiBase}/ops/session`)
  const data = (await res.json()) as { sessionId: string }
  return data.sessionId
}

async function sendMessage(
  apiBase: string,
  sessionId: string,
  message: string,
  confirmationFor?: string,
): Promise<ChatResponse> {
  const res = await fetch(`${apiBase}/ops/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, confirmationFor }),
  })
  return res.json() as Promise<ChatResponse>
}

export function OpsPanel() {
  const apiBase = getApiBase()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const [activeConfirm, setActiveConfirm] = useState<PendingConfirmation | null>(null)
  const [confirmRunning, setConfirmRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSessionId(apiBase).then(setSessionId).catch(console.error)
  }, [apiBase])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, confirmRunning])

  const push = useCallback((msg: Message) => setMessages((prev) => [...prev, msg]), [])

  const submit = useCallback(
    async (text: string, confirmationFor?: string) => {
      if (!sessionId || !text.trim()) return
      setLoading(true)
      if (!confirmationFor) push({ role: 'user', text })
      try {
        const res = await sendMessage(apiBase, sessionId, text, confirmationFor)
        if (res.toolResults) {
          for (const tr of res.toolResults) {
            push({ role: 'tool', text: JSON.stringify(tr.result, null, 2), toolName: tr.toolName })
          }
        }
        if (res.pendingConfirmation) {
          setPending(res.pendingConfirmation)
        }
        if (res.reply) {
          push({ role: 'assistant', text: res.reply })
        }
      } catch (err) {
        push({ role: 'assistant', text: `Error: ${String(err)}` })
      } finally {
        setLoading(false)
      }
    },
    [sessionId, apiBase, push],
  )

  const handleConfirm = useCallback(() => {
    if (!pending) return
    const confirmed = pending
    setActiveConfirm(confirmed)
    setConfirmRunning(true)
    setPending(null)
    push({ role: 'assistant', text: `Executing ${confirmed.toolName} for ${confirmed.projectName}…` })
    const key = `${confirmed.toolName}:${confirmed.projectName}`
    void sendMessage(apiBase, sessionId ?? '', `Confirmed ${confirmed.toolName} for ${confirmed.projectName}.`, key)
      .catch(console.error)
  }, [pending, apiBase, sessionId, push])

  const handleCancel = useCallback(() => {
    setPending(null)
    push({ role: 'user', text: 'Cancel that.' })
    void submit('Cancel that.')
  }, [push, submit])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit(input)
      setInput('')
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] lg:max-h-screen">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center mt-8">
            Ask Claude anything about your infrastructure.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'tool' ? (
              <details className="w-full max-w-prose">
                <summary className="text-xs text-gray-500 cursor-pointer mb-1">{m.toolName} result</summary>
                <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{m.text}</pre>
              </details>
            ) : (
              <div
                className={cn(
                  'rounded-2xl px-3.5 py-2.5 text-sm max-w-prose',
                  m.role === 'user'
                    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100',
                )}
              >
                {m.text}
              </div>
            )}
          </div>
        ))}

        {pending && (
          <div className="rounded-xl border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-4 space-y-3">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Confirm: {pending.toolName} <span className="font-mono">{pending.projectName}</span>?
            </p>
            <div className="flex gap-2">
              <button onClick={handleConfirm} className="flex-1 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium">
                Confirm
              </button>
              <button onClick={handleCancel} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancel
              </button>
            </div>
          </div>
        )}

        {confirmRunning && activeConfirm && (
          <SseOutputPanel
            url={`${apiBase}/projects/${encodeURIComponent(activeConfirm.projectName)}/${activeConfirm.toolName}`}
            method="POST"
            active={confirmRunning}
            onComplete={() => setConfirmRunning(false)}
          />
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 bg-gray-100 dark:bg-gray-800 text-xs text-gray-400">Thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude about your infrastructure…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        <button
          onClick={() => { void submit(input); setInput('') }}
          disabled={loading || !input.trim()}
          className="rounded-xl p-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
