'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'
import { getRollbackSnapshots, rollbackProject } from '@/lib/api'
import { useToast } from '@/components/ui/toast'

interface RollbackPanelProps {
  name: string
  onClose: () => void
}

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

function tagFromRef(ref: string): string {
  return ref.split(':').at(-1) ?? ref
}

function useRollbackSse(url: string, body: string, active: boolean) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()

  useEffect(() => {
    if (!active || !url) return
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
  }, [url, body, active])

  return { lines, exit }
}

export function RollbackPanel({ name, onClose }: RollbackPanelProps) {
  const [snapshots, setSnapshots] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | undefined>()
  const [sseUrl, setSseUrl] = useState('')
  const [sseBody, setSseBody] = useState('')
  const [active, setActive] = useState(false)

  const { showToast } = useToast()
  const { lines, exit } = useRollbackSse(sseUrl, sseBody, active)
  const running = active && exit === undefined
  const done = active && exit !== undefined

  useEffect(() => {
    if (exit === undefined) return
    if (exit === 0) showToast('Rollback completed', 'success')
    else showToast('Rollback failed', 'error')
  }, [exit, showToast])

  useEffect(() => {
    void getRollbackSnapshots(name).then(snaps => {
      setSnapshots(snaps)
      if (snaps.length > 0) setSelected(tagFromRef(snaps[0]!))
    })
  }, [name])

  function handleRestore() {
    const { url, body } = rollbackProject(name, selected)
    setSseUrl(url)
    setSseBody(body)
    setActive(true)
  }

  const termContent = lines.map((l, i) => (
    <div key={i} className="ec-ln">{l}</div>
  ))

  const closeDoneBtn = done && (
    <button
      onClick={onClose}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors mt-3"
    >
      <Icon name="x" size={12} />Close
    </button>
  )

  const snapshotSelect = !active && (
    snapshots === null ? (
      <p className="text-[12px] text-subtle">Loading snapshots...</p>
    ) : snapshots.length === 0 ? (
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-subtle">No rollback snapshots found on this server.</p>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors self-start"
        >
          <Icon name="x" size={12} />Cancel
        </button>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="rounded-lg border border-border bg-card text-[12px] font-mono text-fg px-2 py-1.5 focus:outline-none focus:border-accent"
        >
          {snapshots.map(s => {
            const tag = tagFromRef(s)
            return <option key={tag} value={tag}>{tag}</option>
          })}
        </select>
        <div className="flex gap-2">
          <button
            onClick={handleRestore}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
          >
            <Icon name="refresh" size={12} />Restore
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
          >
            <Icon name="x" size={12} />Cancel
          </button>
        </div>
      </div>
    )
  )

  return (
    <>
      {/* Desktop: inline below containers */}
      <div className="hidden lg:flex flex-col gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-subtle flex items-center gap-1.5">
          <Icon name="refresh" size={13} />Rollback
        </div>
        {snapshotSelect}
        {active && (
          <Terminal title={`rollback · ${name}`} running={running} exit={exit} style={{ minHeight: 200 }}>
            {termContent}
          </Terminal>
        )}
        {closeDoneBtn}
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
            <Icon name="refresh" size={15} style={{ color: 'var(--accent-bright)' }} />
            <span className="text-[14px] font-semibold text-fg">Rollback {name}</span>
            <div className="flex-1" />
            {!running && (
              <button onClick={onClose} className="text-subtle hover:text-fg">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <div className="px-4 py-3">
            {snapshotSelect}
          </div>
          {active && (
            <Terminal
              title={`rollback · ${name}`}
              running={running}
              exit={exit}
              bar={false}
              style={{ flex: 1, minHeight: 0 }}
              bodyStyle={{ flex: 1, minHeight: 0, fontSize: 11 }}
            >
              {termContent}
            </Terminal>
          )}
          {closeDoneBtn && <div className="px-4 pb-4">{closeDoneBtn}</div>}
        </div>
      </div>
    </>
  )
}
