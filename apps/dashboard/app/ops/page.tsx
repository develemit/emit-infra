'use client'
import { useState, useEffect, useCallback } from 'react'
import { getApiBase } from '@/lib/api'
import { Icon } from '@/components/icon'
import { ChatThread } from '@/components/ops/chat-thread'
import { ChatInput } from '@/components/ops/chat-input'
import type { ChatMessage, ChatResponse, ConfirmType } from '@/components/ops/types'

function genId() {
  return Math.random().toString(36).slice(2)
}

function getConfirmText(toolName: string, projectName: string) {
  if (toolName === 'destroy') return {
    subtitle: `Destroy ${projectName}`,
    description: 'This will permanently destroy all Hetzner infrastructure. This action cannot be undone.',
  }
  if (toolName === 'provision') return {
    subtitle: `Provision ${projectName}`,
    description: 'Creates new infrastructure on Hetzner via Terraform and configures it with Ansible.',
  }
  return {
    subtitle: `Deploy ${projectName}`,
    description: 'Runs Ansible to pull the latest code and restart application containers.',
  }
}

export default function OpsPage() {
  const apiBase = getApiBase()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/ops/session`)
      .then(r => r.json() as Promise<{ sessionId: string }>)
      .then(d => setSessionId(d.sessionId))
      .catch(console.error)
  }, [apiBase])

  const push = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev, msg])
  }, [])

  const submit = useCallback(async (text: string) => {
    if (!sessionId || !text.trim() || loading) return
    setLoading(true)
    push({ id: genId(), type: 'user', text })
    try {
      const res = await fetch(`${apiBase}/ops/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      })
      const data = await res.json() as ChatResponse

      if (data.toolResults) {
        for (const tr of data.toolResults) {
          push({ id: genId(), type: 'tool', toolName: tr.toolName, target: tr.target ?? 'all', result: tr.result })
        }
      }
      if (data.pendingConfirmation) {
        const { toolName, projectName } = data.pendingConfirmation
        const { subtitle, description } = getConfirmText(toolName, projectName)
        push({
          id: genId(),
          type: 'confirm',
          confirmationType: toolName as ConfirmType,
          projectName,
          subtitle,
          description,
          sseUrl: `${apiBase}/ops/chat`,
          sseBody: JSON.stringify({
            sessionId,
            message: `Confirmed ${toolName} for ${projectName}.`,
            confirmationFor: `${toolName}:${projectName}`,
          }),
        })
      }
      if (data.reply) {
        push({ id: genId(), type: 'claude', text: data.reply })
      }
    } catch (err) {
      push({ id: genId(), type: 'claude', text: `Error: ${String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [sessionId, apiBase, loading, push])

  function handleCancel() {
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.type === 'confirm')
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      return prev.filter((_, i) => i !== realIdx)
    })
    void submit('Cancel that.')
  }

  async function handleNewConversation() {
    if (sessionId) {
      await fetch(`${apiBase}/ops/session/${sessionId}`, { method: 'DELETE' }).catch(() => {})
    }
    setMessages([])
    try {
      const res = await fetch(`${apiBase}/ops/session`)
      const data = await res.json() as { sessionId: string }
      setSessionId(data.sessionId)
    } catch {
      // keep existing session id
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div
        className="flex items-center gap-3 px-4 lg:px-6 border-b border-border shrink-0"
        style={{ height: 56 }}
      >
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-soft)' }}
        >
          <Icon name="zap" size={13} style={{ color: 'var(--accent-bright)' }} />
        </div>
        <span className="text-[15px] font-semibold text-fg">Claude Ops</span>
        <div className="flex-1" />
        <button
          onClick={() => void handleNewConversation()}
          className="text-[12px] text-subtle hover:text-fg transition-colors"
        >
          New conversation
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Messages — extra bottom padding on mobile for fixed input */}
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-[120px] lg:pb-4">
          <div className="lg:max-w-[720px] lg:mx-auto">
            <ChatThread messages={messages} loading={loading} onCancel={handleCancel} />
          </div>
        </div>

        {/* Desktop input: inside the flex column */}
        <div className="hidden lg:block pb-4">
          <div className="max-w-[720px] mx-auto px-4">
            <ChatInput onSubmit={text => void submit(text)} disabled={loading} />
          </div>
        </div>
      </div>

      {/* Mobile input: fixed above tab bar */}
      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-2 border-t border-border bg-elev">
        <ChatInput onSubmit={text => void submit(text)} disabled={loading} />
      </div>
    </div>
  )
}
