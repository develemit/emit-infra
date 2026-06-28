'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'
import { syncSecrets } from '@/lib/api'
import { useToast } from '@/components/ui/toast'

interface SecretsSyncPanelProps {
  name: string
  onClose: () => void
}

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export function SecretsSyncPanel({ name, onClose }: SecretsSyncPanelProps) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()

  const { showToast } = useToast()
  const { url } = syncSecrets(name)
  const running = exit === undefined
  const failed = exit !== undefined && exit !== 0
  const title = `secrets-sync · ${name}`

  useEffect(() => {
    if (exit === undefined) return
    if (exit === 0) showToast('Secrets synced', 'success')
    else showToast('Secrets sync failed', 'error')
  }, [exit, showToast])

  useEffect(() => {
    const ctrl = new AbortController()
    async function run() {
      try {
        const res = await fetch(url, { method: 'POST', signal: ctrl.signal })
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
            else if (ev.type === 'error') {
              setLines(p => [...p, `error: ${ev.message}`])
              setExit(1)
            }
          }
        }
      } catch {
        // aborted or network error
      }
    }
    void run()
    return () => ctrl.abort()
  }, [url])

  const termContent = lines.map((l, i) => (
    <div key={i} className="ec-ln">{l}</div>
  ))

  const footer = !running && (
    <div className="flex flex-col gap-2 mt-3">
      {failed && (
        <p className="text-[12px] text-err">
          Sync failed — make sure <code className="font-mono">gh</code> is installed and authenticated.
        </p>
      )}
      <button
        onClick={onClose}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors self-start"
      >
        <Icon name="x" size={12} />Close
      </button>
    </div>
  )

  return (
    <>
      {/* Desktop: inline */}
      <div className="hidden lg:flex flex-col gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-subtle flex items-center gap-1.5">
          <Icon name="lock" size={13} />Sync Secrets
        </div>
        <Terminal title={title} running={running} exit={exit} style={{ minHeight: 200 }}>
          {termContent}
        </Terminal>
        {footer}
      </div>

      {/* Mobile: bottom sheet */}
      <div className="lg:hidden fixed inset-0 z-50">
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-strong bg-card"
          style={{ top: '25%', boxShadow: '0 -20px 50px rgba(0,0,0,.4)' }}
        >
          <div className="flex justify-center pt-3 pb-2">
            <div className="rounded-full" style={{ width: 36, height: 4, background: 'var(--border-strong)' }} />
          </div>
          <div className="flex items-center gap-2 px-4 pb-3 border-b border-border">
            <Icon name="lock" size={15} style={{ color: 'var(--accent-bright)' }} />
            <span className="text-[14px] font-semibold text-fg">Sync Secrets — {name}</span>
            <div className="flex-1" />
            {!running && (
              <button onClick={onClose} className="text-subtle hover:text-fg">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <Terminal
            title={title}
            running={running}
            exit={exit}
            bar={false}
            style={{ flex: 1, minHeight: 0 }}
            bodyStyle={{ flex: 1, minHeight: 0, fontSize: 11 }}
          >
            {termContent}
          </Terminal>
          {failed && (
            <p className="px-4 py-2 text-[12px] text-err">
              Sync failed — make sure <code className="font-mono">gh</code> is installed and authenticated.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
