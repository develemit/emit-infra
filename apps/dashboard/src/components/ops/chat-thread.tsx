'use client'
import { useRef, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { UserMessage, ClaudeMessage } from './message'
import { ToolBlock } from './tool-block'
import { ConfirmCard } from './confirm-card'
import type { ChatMessage } from './types'

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5">
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-soft)' }}
      >
        <Icon name="zap" size={13} style={{ color: 'var(--accent-bright)' }} />
      </div>
      <div
        className="flex items-center gap-1.5 px-3.5 py-3 rounded-2xl border border-border"
        style={{ background: 'var(--card-2)', borderBottomLeftRadius: 4 }}
      >
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="block rounded-full"
            style={{
              width: 6, height: 6,
              background: 'var(--fg-muted)',
              animation: `ec-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface Props {
  messages: ChatMessage[]
  loading: boolean
  onCancel: () => void
}

export function ChatThread({ messages, loading, onCancel }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, background: 'var(--accent-soft)' }}
        >
          <Icon name="zap" size={20} style={{ color: 'var(--accent-bright)' }} />
        </div>
        <p className="text-[13.5px] text-muted text-center" style={{ maxWidth: 280 }}>
          Ask Claude about your infrastructure — status, logs, deployments.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map(msg => {
        if (msg.type === 'user') return <UserMessage key={msg.id} text={msg.text} />
        if (msg.type === 'claude') return <ClaudeMessage key={msg.id}>{msg.text}</ClaudeMessage>
        if (msg.type === 'tool') return (
          <ToolBlock key={msg.id} toolName={msg.toolName} target={msg.target} result={msg.result} />
        )
        if (msg.type === 'confirm') return (
          <ConfirmCard
            key={msg.id}
            type={msg.confirmationType}
            projectName={msg.projectName}
            subtitle={msg.subtitle}
            description={msg.description}
            sseUrl={msg.sseUrl}
            sseBody={msg.sseBody}
            onConfirm={() => {}}
            onCancel={onCancel}
          />
        )
        return null
      })}
      {loading && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  )
}
