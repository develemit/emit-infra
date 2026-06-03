'use client'
import { useState } from 'react'
import { Icon } from '@/components/icon'

interface Props {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function ChatInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState('')

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) {
        onSubmit(value.trim())
        setValue('')
      }
    }
  }

  function handleSend() {
    if (value.trim() && !disabled) {
      onSubmit(value.trim())
      setValue('')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex items-end gap-2 rounded-xl border border-border bg-card"
        style={{ padding: '5px 5px 5px 14px' }}
      >
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude about your infrastructure…"
          rows={1}
          className="flex-1 resize-none bg-transparent text-[13.5px] text-fg placeholder:text-muted focus:outline-none"
          style={{ minHeight: 36, paddingTop: 8 }}
        />
        <button
          onClick={handleSend}
          disabled={disabled ?? !value.trim()}
          className="flex items-center justify-center rounded-lg text-accent-fg bg-accent hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
          style={{ width: 36, height: 36 }}
        >
          <Icon name="send" size={15} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <Icon name="shield" size={12} style={{ color: 'var(--fg-faint)', flexShrink: 0 }} />
        <span className="text-[11px]" style={{ color: 'var(--fg-faint)' }}>
          Claude can read status &amp; logs freely; deploy, provision &amp; destroy always ask first.
        </span>
      </div>
    </div>
  )
}
