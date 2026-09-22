'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'
import { getRollbackSnapshots, rollbackProject } from '@/lib/api-projects'
import { useToast } from '@/components/ui/toast'
import { useSseStream } from '@/lib/use-sse-stream'
import { ActionSheet } from '@/components/detail/action-sheet'

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

  useSseStream<SseEvent>(url, {
    headers: { 'Content-Type': 'application/json' },
    body,
    enabled: active && !!url,
    onEvent(ev) {
      if (ev.type === 'line') setLines(p => [...p, ev.text])
      else if (ev.type === 'done') setExit(ev.exitCode)
      else if (ev.type === 'error') { setLines(p => [...p, `error: ${ev.message}`]); setExit(1) }
    },
  })

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
    <ActionSheet title={`Rollback ${name}`} icon="refresh" onClose={onClose} closeDisabled={running}>
      {snapshotSelect}
      {active && (
        <Terminal title={`rollback · ${name}`} running={running} exit={exit} style={{ minHeight: 200 }}>
          {termContent}
        </Terminal>
      )}
    </ActionSheet>
  )
}
