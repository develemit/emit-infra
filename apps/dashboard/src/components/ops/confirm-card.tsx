'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { Terminal } from '@/components/ui/terminal'
import type { ConfirmType } from './types'

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

function useSse(url: string, body: string, active: boolean) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()

  useEffect(() => {
    if (!active) return
    const ctrl = new AbortController()
    async function run() {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        })
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const data = part.split('\n').find(l => l.startsWith('data:'))
            if (!data) continue
            const ev = JSON.parse(data.slice(5).trim()) as SseEvent
            if (ev.type === 'line') setLines(p => [...p, ev.text])
            else if (ev.type === 'done') setExit(ev.exitCode)
            else if (ev.type === 'error') { setLines(p => [...p, `error: ${ev.message}`]); setExit(1) }
          }
        }
      } catch {
        // aborted
      }
    }
    void run()
    return () => ctrl.abort()
  }, [url, body, active])

  return { lines, exit }
}

interface Props {
  type: ConfirmType
  projectName: string
  subtitle: string
  description: string
  sseUrl: string
  sseBody: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmCard({ type, projectName, subtitle, description, sseUrl, sseBody, onConfirm, onCancel }: Props) {
  const [confirmed, setConfirmed] = useState(false)
  const isDestroy = type === 'destroy'
  const { lines, exit } = useSse(sseUrl, sseBody, confirmed)

  if (confirmed) {
    return (
      <Terminal title={`${type} · ${projectName}`} running={exit === undefined} exit={exit} bodyStyle={{ maxHeight: 200 }}>
        {lines.map((l, i) => <div key={i} className="ec-ln">{l}</div>)}
      </Terminal>
    )
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        border: `1px solid ${isDestroy ? 'var(--err-line)' : 'var(--accent-line)'}`,
        background: isDestroy ? 'var(--err-soft)' : 'var(--accent-soft)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{
            width: 30, height: 30,
            background: isDestroy ? 'var(--err-soft)' : 'var(--accent-soft)',
            border: `1px solid ${isDestroy ? 'var(--err-line)' : 'var(--accent-line)'}`,
          }}
        >
          <Icon name={isDestroy ? 'trash' : 'deploy'} size={15} style={{ color: isDestroy ? 'var(--err)' : 'var(--accent-bright)' }} />
        </div>
        <span className="text-[13.5px] font-semibold text-fg flex-1">{subtitle}</span>
        {isDestroy && (
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-md"
            style={{ background: 'var(--err-soft)', color: 'var(--err)', border: '1px solid var(--err-line)' }}
          >
            irreversible
          </span>
        )}
      </div>

      <p className="text-[12.5px] text-muted">{description}</p>

      <div className="flex items-center gap-2">
        <button
          onClick={() => { setConfirmed(true); onConfirm() }}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-medium transition-opacity hover:opacity-90 ${isDestroy ? 'text-white' : 'text-accent-fg bg-accent'}`}
          style={isDestroy ? { background: 'var(--err)' } : {}}
        >
          <Icon name={isDestroy ? 'trash' : 'check'} size={13} />
          {isDestroy ? 'Confirm destroy' : 'Confirm'}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center px-3.5 py-2 rounded-lg text-[12.5px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
