'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { syncSecrets } from '@/lib/api-secrets'
import { useToast } from '@/components/ui/toast'
import { useSseStream } from '@/lib/use-sse-stream'
import { ActionSheet } from '@/components/detail/action-sheet'

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

  useSseStream<SseEvent>(url, {
    onEvent(ev) {
      if (ev.type === 'line') setLines(p => [...p, ev.text])
      else if (ev.type === 'done') setExit(ev.exitCode)
      else if (ev.type === 'error') { setLines(p => [...p, `error: ${ev.message}`]); setExit(1) }
    },
  })

  const termContent = lines.map((l, i) => (
    <div key={i} className="ec-ln">{l}</div>
  ))

  return (
    <ActionSheet title={`Sync Secrets — ${name}`} icon="lock" onClose={onClose} closeDisabled={running}>
      <Terminal title={title} running={running} exit={exit} style={{ minHeight: 200 }}>
        {termContent}
      </Terminal>
      {failed && (
        <p className="text-[12px] text-err">
          Sync failed — make sure <code className="font-mono">gh</code> is installed and authenticated.
        </p>
      )}
    </ActionSheet>
  )
}
