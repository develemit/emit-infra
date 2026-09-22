'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { useToast } from '@/components/ui/toast'
import { useSseStream } from '@/lib/use-sse-stream'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ActionSheet } from '@/components/detail/action-sheet'

interface DeployPanelProps {
  url: string
  name: string
  buildNumber?: string | null
  disk?: number
  memory?: number
  onClose: () => void
}

type Step = 'confirm' | 'running'

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'backup'; status: 'started' | 'ok' | 'warn'; message: string }

function useDeploySse(url: string, active: boolean) {
  const [lines, setLines] = useState<{ text: string; color?: string }[]>([])
  const [exit, setExit] = useState<number | undefined>()

  useSseStream<SseEvent>(url, {
    enabled: active,
    onEvent(ev) {
      if (ev.type === 'line') setLines(p => [...p, { text: ev.text }])
      else if (ev.type === 'done') setExit(ev.exitCode)
      else if (ev.type === 'error') { setLines(p => [...p, { text: `error: ${ev.message}` }]); setExit(1) }
      else if (ev.type === 'backup') {
        const color = ev.status === 'ok' ? 'var(--ok)' : ev.status === 'warn' ? 'var(--warn)' : 'var(--fg-muted)'
        const prefix = ev.status === 'ok' ? '✓' : ev.status === 'warn' ? '⚠' : '●'
        setLines(p => [...p, { text: `${prefix} Backup: ${ev.message}`, color }])
      }
    },
  })

  return { lines, exit }
}

export function DeployPanel({ url, name, buildNumber, disk, memory, onClose }: DeployPanelProps) {
  const [step, setStep] = useState<Step>('confirm')
  const { showToast } = useToast()
  const { lines, exit } = useDeploySse(url, step === 'running')
  const running = step === 'running' && exit === undefined
  const title = `deploy · ${name}`

  useEffect(() => {
    if (exit === undefined) return
    if (exit === 0) showToast(`Deployed ${name}`, 'success')
    else showToast(`Deploy failed for ${name}`, 'error')
  }, [exit, name, showToast])

  if (step === 'confirm') {
    const pressureWarning = (disk ?? 0) >= 80 || (memory ?? 0) >= 80
      ? `Disk at ${disk ?? '?'}%, memory at ${memory ?? '?'}% — server may be under pressure.`
      : null

    return (
      <ConfirmDialog
        title={`Deploy ${name}?`}
        subtitle={buildNumber ? `current build ${buildNumber}` : undefined}
        icon="deploy"
        tone={pressureWarning ? 'warn' : 'default'}
        confirmLabel="Deploy"
        onConfirm={() => setStep('running')}
        onCancel={onClose}
      >
        <p>This starts a new deploy for <strong>{name}</strong>.</p>
        {pressureWarning && <p className="text-warn">{pressureWarning}</p>}
      </ConfirmDialog>
    )
  }

  const termContent = lines.map((l, i) => (
    <div key={i} className="ec-ln" style={l.color ? { color: l.color } : undefined}>{l.text}</div>
  ))

  return (
    <ActionSheet title={`Deploying ${name}`} icon="deploy" onClose={onClose} closeDisabled={running}>
      <Terminal
        title={title}
        running={running}
        exit={exit}
        style={{ minHeight: 200 }}
        bodyStyle={{ fontSize: 12 }}
      >
        {termContent}
      </Terminal>
    </ActionSheet>
  )
}
