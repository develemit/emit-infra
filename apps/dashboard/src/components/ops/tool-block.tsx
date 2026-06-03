'use client'
import { useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'

function ColoredJson({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2)
  const parts = json.split(/("(?:[^"\\]|\\.)*"|-?\b\d+(?:\.\d+)?\b|true|false|null)/)
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part
        if (part.startsWith('"')) return <span key={i} style={{ color: 'var(--t-green)' }}>{part}</span>
        return <span key={i} style={{ color: 'var(--t-yellow)' }}>{part}</span>
      })}
    </>
  )
}

interface Props {
  toolName: string
  target: string
  result: unknown
}

export function ToolBlock({ toolName, target, result }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border border-border" style={{ background: 'var(--card-2)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <Icon name="zap" size={13} style={{ color: 'var(--accent-bright)', flexShrink: 0 }} />
        <span className="text-[12.5px] font-medium text-fg">{toolName}</span>
        {target !== 'all' && (
          <>
            <span className="text-[12px]" style={{ color: 'var(--fg-faint)' }}>→</span>
            <span className="text-[12.5px] font-mono" style={{ color: 'var(--accent-bright)' }}>{target}</span>
          </>
        )}
        <div className="flex-1" />
        <Badge variant="ok">200</Badge>
        <span
          className="transition-transform duration-150"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <Icon name="chevRight" size={13} style={{ color: 'var(--fg-subtle)' }} />
        </span>
      </button>

      {open && (
        <div
          className="px-3 py-2.5 rounded-b-xl overflow-x-auto"
          style={{ background: 'var(--term-bg)' }}
        >
          <pre className="text-[11.5px] font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--t-fg)' }}>
            <ColoredJson value={result} />
          </pre>
        </div>
      )}
    </div>
  )
}
