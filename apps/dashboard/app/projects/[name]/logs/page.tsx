'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import AnsiToHtml from 'ansi-to-html'
import { getContainers, openSseStream } from '@/lib/api'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'

const ansi = new AnsiToHtml({ escapeXML: true })

const COLOR_PALETTE = [
  'var(--t-blue)', 'var(--t-cyan)', 'var(--t-magenta)',
  'var(--t-green)', 'var(--t-yellow)',
]

const MAX_LOG_LINES = 5000

type LogLine = { svc: string; svcColor: string; text: string }

type SseParsed =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export default function LogsPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [lines, setLines] = useState<LogLine[]>([])
  const [running, setRunning] = useState(false)
  const [follow, setFollow] = useState(true)
  const [service, setService] = useState('')
  const [services, setServices] = useState<string[]>([])
  const svcColorMap = useRef<Map<string, string>>(new Map())
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    getContainers(name)
      .then(cs => setServices(cs.map(c => c.name)))
      .catch(() => {})
  }, [name])

  function svcColor(svc: string): string {
    if (!svcColorMap.current.has(svc)) {
      const idx = svcColorMap.current.size % COLOR_PALETTE.length
      svcColorMap.current.set(svc, COLOR_PALETTE[idx]!)
    }
    return svcColorMap.current.get(svc)!
  }

  const stop = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setRunning(false)
  }, [])

  const start = useCallback(() => {
    if (esRef.current) return
    const path = `/projects/${encodeURIComponent(name)}/logs${service ? `?service=${encodeURIComponent(service)}` : ''}`
    const es = openSseStream(path)
    esRef.current = es
    setRunning(true)
    es.onmessage = (e: MessageEvent<string>) => {
      const ev = JSON.parse(e.data) as SseParsed
      if (ev.type === 'line') {
        const raw = ev.text
        const pipeIdx = raw.indexOf(' | ')
        const svc = pipeIdx > 0 ? raw.slice(0, pipeIdx).trim() : ''
        const text = pipeIdx > 0 ? raw.slice(pipeIdx + 3) : raw
        setLines(prev => {
          const next = [...prev, { svc, svcColor: svc ? svcColor(svc) : 'var(--term-fg)', text }]
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next
        })
      } else {
        stop()
      }
    }
    es.onerror = () => stop()
  }, [name, service, stop])

  useEffect(() => {
    start()
    return stop
  }, [start, stop])

  const controls = (
    <>
      <div className="relative" style={{ width: 160 }}>
        <select
          value={service}
          onChange={e => { stop(); setService(e.target.value); setLines([]) }}
          className="w-full h-[34px] pl-3 pr-8 rounded-lg text-[12.5px] font-mono text-fg bg-card border border-border appearance-none focus:outline-none focus:border-accent"
        >
          <option value="">all services</option>
          {services.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle pointer-events-none">
          <Icon name="chevDown" size={13} />
        </span>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-muted cursor-pointer select-none">
        <button
          role="switch"
          aria-checked={follow}
          onClick={() => setFollow(f => !f)}
          className="rounded-full transition-colors"
          style={{
            width: 32, height: 18,
            background: follow ? 'var(--accent)' : 'var(--border-strong)',
            position: 'relative',
          }}
        >
          <span
            className="absolute rounded-full bg-white transition-transform"
            style={{
              width: 12, height: 12, top: 3,
              left: follow ? 17 : 3,
              transition: 'left 0.15s',
            }}
          />
        </button>
        Follow
      </label>
      <button
        onClick={running ? stop : start}
        className="inline-flex items-center gap-1.5 px-3 h-[34px] rounded-lg text-[12px] font-medium text-err border border-err-line hover:bg-err-soft transition-colors"
      >
        <Icon name={running ? 'stop' : 'play'} size={13} />{running ? 'Stop' : 'Start'}
      </button>
    </>
  )

  const termLines = lines.map((l, i) => (
    <div key={i} className="ec-ln">
      {l.svc && (
        <>
          <span style={{ color: l.svcColor, minWidth: 108, display: 'inline-block', fontWeight: 500 }}>{l.svc}</span>
          <span style={{ color: 'var(--term-dim)', margin: '0 10px' }}>│</span>
        </>
      )}
      <span style={{ flex: 1 }} dangerouslySetInnerHTML={{ __html: ansi.toHtml(l.text) }} />
    </div>
  ))

  return (
    <div className="flex flex-col h-full">
      {/* Desktop topbar */}
      <div className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0" style={{ height: 56 }}>
        <Link href={`/projects/${encodeURIComponent(name)}`} className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">Logs</span>
        <span className="text-[12px] font-mono text-subtle">{name} · docker compose</span>
        <div className="flex-1" />
        {controls}
      </div>

      {/* Mobile header */}
      <div className="lg:hidden flex items-center gap-2.5 px-4 border-b border-border shrink-0" style={{ height: 52 }}>
        <Link href={`/projects/${encodeURIComponent(name)}`} className="text-subtle"><Icon name="arrowLeft" size={18} /></Link>
        <span className="text-[15px] font-semibold text-fg">Logs</span>
        <div className="flex-1" />
        {running && <span className="font-mono text-[11px] text-t-green">● live</span>}
      </div>

      {/* Mobile controls */}
      <div className="lg:hidden flex items-center gap-2.5 px-4 py-2.5 border-b border-border shrink-0">
        {controls}
      </div>

      {/* Terminal fills remaining height */}
      <div className="flex-1 min-h-0 p-3 lg:p-4">
        <Terminal
          title={`${name} · tail -f`}
          running={running && follow}
          footer={false}
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ flex: 1, minHeight: 0 }}
        >
          {termLines}
        </Terminal>
      </div>
    </div>
  )
}
