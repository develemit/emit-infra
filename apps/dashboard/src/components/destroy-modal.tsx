'use client'
import { useState, useEffect } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'

interface Props {
  projectName: string
  apiBase: string
  onClose: () => void
}

type Step = 'warning' | 'confirm' | 'running'

type SseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

function useDestroySse(url: string, active: boolean) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()

  useEffect(() => {
    if (!active) return
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
            else if (ev.type === 'error') { setLines(p => [...p, `error: ${ev.message}`]); setExit(1) }
          }
        }
      } catch {
        // aborted
      }
    }
    void run()
    return () => ctrl.abort()
  }, [url, active])

  return { lines, exit }
}

export function DestroyModal({ projectName, apiBase, onClose }: Props) {
  const [step, setStep] = useState<Step>('warning')
  const [input, setInput] = useState('')
  const url = `${apiBase}/projects/${encodeURIComponent(projectName)}/destroy`
  const { lines, exit } = useDestroySse(url, step === 'running')
  const running = step === 'running' && exit === undefined
  const canConfirm = input === projectName

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div
        className="w-full flex flex-col rounded-2xl border overflow-hidden"
        style={{
          maxWidth: step === 'running' ? 520 : 460,
          maxHeight: '90vh',
          background: 'var(--card)',
          borderColor: 'var(--err-line)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div
            className="flex items-center justify-center rounded-[9px] shrink-0 text-err"
            style={{ width: 34, height: 34, background: 'var(--err-soft)', border: '1px solid var(--err-line)' }}
          >
            <Icon name="alert" size={17} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-fg">
              {step === 'running' ? `Destroying ${projectName}` : `Destroy ${projectName}?`}
            </div>
            <div className="text-[11.5px] font-mono text-subtle">
              {projectName}
            </div>
          </div>
          <div className="flex-1" />
          {step !== 'running' && (
            <button onClick={onClose} className="text-subtle hover:text-fg transition-colors">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
          {step === 'warning' && (
            <>
              <div
                className="flex items-start gap-2.5 rounded-lg p-3 text-[12px] text-err border border-err-line bg-err-soft"
              >
                <Icon name="alert" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><strong>This is irreversible.</strong> Terraform will permanently destroy all managed infrastructure for this project. There is no undo.</span>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle mb-2">Will be destroyed</p>
                <ul className="flex flex-col gap-2">
                  {[
                    { icon: 'server', text: `Server · ${projectName}` },
                    { icon: 'globe', text: 'DNS records' },
                    { icon: 'database', text: 'Storage buckets' },
                  ].map(item => (
                    <li key={item.icon} className="flex items-center gap-2 text-[12.5px] text-muted">
                      <Icon name={item.icon} size={14} style={{ color: 'var(--fg-subtle)', flexShrink: 0 }} />
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {step === 'confirm' && (
            <>
              <p className="text-[13px] text-muted leading-[1.55]">
                To confirm, type the project name{' '}
                <code
                  className="font-mono text-fg rounded px-1.5 py-0.5"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)' }}
                >
                  {projectName}
                </code>{' '}
                below.
              </p>
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono text-fg bg-card"
                  style={{
                    border: '1px solid var(--err-line)',
                    boxShadow: '0 0 0 3px var(--err-soft)',
                    outline: 'none',
                  }}
                  placeholder={projectName}
                />
                {canConfirm && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ok">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </div>
            </>
          )}

          {step === 'running' && (
            <>
              <Terminal
                title={`terraform destroy · ${projectName}`}
                running={running}
                exit={exit}
                style={{ minHeight: 200 }}
              >
                {lines.map((l, i) => <div key={i} className="ec-ln">{l}</div>)}
              </Terminal>
              <div className="flex items-center gap-2 rounded-lg p-3 text-[12px] text-err border border-err-line bg-err-soft">
                <Icon name="alert" size={14} style={{ flexShrink: 0 }} />
                <span>Do not close this window while destroy is running.</span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          {step === 'warning' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 rounded-lg text-[13px] font-medium text-subtle border border-border hover:bg-card-hover transition-colors">Cancel</button>
              <button onClick={() => setStep('confirm')} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium text-white bg-err hover:opacity-90 transition-opacity">
                <Icon name="trash" size={13} />Continue
              </button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 rounded-lg text-[13px] font-medium text-subtle border border-border hover:bg-card-hover transition-colors">Cancel</button>
              <button
                onClick={() => canConfirm && setStep('running')}
                disabled={!canConfirm}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium text-white bg-err hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                <Icon name="trash" size={13} />Destroy {projectName}
              </button>
            </>
          )}
          {step === 'running' && !running && (
            <button onClick={onClose} className="flex-1 py-2 rounded-lg text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors">Close</button>
          )}
          {step === 'running' && running && (
            <div className="flex-1 flex items-center justify-center">
              <span className="ec-exit streaming"><span className="ec-spinner" />destroying…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
