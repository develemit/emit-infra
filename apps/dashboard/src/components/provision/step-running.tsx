'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Terminal } from '@/components/ui/terminal'
import { useSseStream } from '@/lib/use-sse-stream'

type PhaseState = 'pending' | 'running' | 'done'

interface PhaseRowProps {
  label: string
  state: PhaseState
  detail?: string
}

function PhaseRow({ label, state, detail }: PhaseRowProps) {
  const icon = state === 'done'
    ? <div className="flex items-center justify-center rounded" style={{ width: 24, height: 24, background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="check" size={13} /></div>
    : state === 'running'
    ? <div className="flex items-center justify-center rounded" style={{ width: 24, height: 24, background: 'var(--accent-soft)' }}><span className="ec-spinner" style={{ color: 'var(--accent-bright)' }} /></div>
    : <div className="flex items-center justify-center rounded" style={{ width: 24, height: 24, background: 'var(--bg-elev)' }}><Icon name="clock" size={13} style={{ color: 'var(--fg-faint)' }} /></div>

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-b-0">
      {icon}
      <span className="flex-1 text-[13px] font-semibold text-fg">{label}</span>
      {detail && <span className="text-[11.5px] font-mono" style={{ color: state === 'running' ? 'var(--accent-bright)' : 'var(--fg-subtle)' }}>{detail}</span>}
    </div>
  )
}

interface Props {
  url: string
  body: string
  name: string
}

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export function StepRunning({ url, body, name }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()
  const [terraform, setTerraform] = useState<PhaseState>('running')
  const [ansible, setAnsible] = useState<PhaseState>('pending')
  const [terraformDetail, setTerraformDetail] = useState<string>()
  const running = exit === undefined

  useSseStream<SseEvent>(url, {
    headers: { 'Content-Type': 'application/json' },
    body,
    onEvent(ev) {
      if (ev.type === 'line') {
        const text = ev.text
        setLines(p => [...p, text])
        if (text.includes('Apply complete')) {
          setTerraform('done')
          setAnsible('running')
          const m = text.match(/(\d+) added/)
          if (m) setTerraformDetail(`${m[1]} added`)
        }
      } else if (ev.type === 'done') {
        setExit(ev.exitCode)
        setTerraform('done')
        setAnsible('done')
      } else if (ev.type === 'error') {
        setLines(p => [...p, `error: ${ev.message}`])
        setExit(1)
      }
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card" style={{ padding: '4px 16px' }}>
        <PhaseRow label="Terraform" state={terraform} detail={terraform === 'done' ? (terraformDetail ?? 'complete') : undefined} />
        <PhaseRow label="Ansible" state={ansible} detail={ansible === 'running' ? 'running' : undefined} />
      </div>

      <Terminal title={`provision · ${name}`} running={running} exit={exit} bodyStyle={{ maxHeight: 220 }}>
        {lines.map((l, i) => <div key={i} className="ec-ln">{l}</div>)}
      </Terminal>

      {exit !== undefined && exit !== 0 && (
        <div className="flex items-center gap-2 rounded-lg p-3 text-[12px] text-err border border-err-line bg-err-soft">
          <Icon name="alert" size={14} style={{ flexShrink: 0 }} />
          Provisioning failed — check terminal output above for details.
        </div>
      )}

      {exit === 0 && (
        <Link
          href={`/projects/${encodeURIComponent(name)}`}
          className="flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
        >
          View Project <Icon name="chevRight" size={14} />
        </Link>
      )}
    </div>
  )
}
