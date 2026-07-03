'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import AnsiToHtml from 'ansi-to-html'
import { getCiLog, getDeployLog } from '@/lib/api'
import { getCiStatus, getDeployStatus } from '@/lib/api-containers'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'

interface Props {
  type: 'ci' | 'deploy'
  name: string
  sha: string
}

const ansiConverter = new AnsiToHtml({ escapeXML: true })

function useRunningState(type: 'ci' | 'deploy', name: string) {
  const [running, setRunning] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const status = type === 'ci'
        ? await getCiStatus(name)
        : await getDeployStatus(name)
      if (cancelled) return
      const active = status?.status === 'running' || status?.status === 'deploying'
      setRunning(active)
    }
    void check()
    const id = setInterval(() => void check(), 5_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [type, name])

  return running
}

export function RunLogPage({ type, name, sha }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const running = useRunningState(type, name)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchLog = useCallback(() => {
    const fn = type === 'ci' ? getCiLog : getDeployLog
    fn(name, sha).then(setContent).catch(() => setContent(''))
  }, [type, name, sha])

  useEffect(() => {
    fetchLog()
    if (!running) return
    const id = setInterval(fetchLog, 3_000)
    return () => clearInterval(id)
  }, [fetchLog, running])

  useEffect(() => {
    if (running && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [content, running])

  const title = type === 'ci' ? 'CI Log' : 'Deploy Log'
  const backHref = `/projects/${encodeURIComponent(name)}`
  const shortSha = sha.slice(0, 7)

  let body: React.ReactNode
  if (content === null) {
    body = (
      <div className="flex items-center justify-center h-full text-[12px] font-mono text-subtle">
        loading…
      </div>
    )
  } else if (content === '') {
    body = (
      <div className="flex items-center justify-center h-full text-[12px] font-mono text-subtle">
        Log not available — this run predates log capture
      </div>
    )
  } else {
    const htmlLines = ansiConverter.toHtml(content).split('\n')
    const termLines = htmlLines.map((line, i) => (
      <div key={i} className="ec-ln" dangerouslySetInnerHTML={{ __html: line }} />
    ))
    body = (
      <Terminal
        title={`${name} · ${shortSha}`}
        running={running}
        footer={false}
        scrollBottom
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, minHeight: 0 }}
      >
        {termLines}
        <div ref={bottomRef} />
      </Terminal>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0" style={{ height: 56 }}>
        <Link href={backHref} className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">{title}</span>
        <span className="text-[12px] font-mono text-subtle">{name} · {shortSha}</span>
        {running && (
          <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full" style={{ color: 'var(--accent)', background: 'var(--card-2)', border: '1px solid var(--accent)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
            live
          </span>
        )}
      </div>

      <div className="lg:hidden flex items-center gap-2.5 px-4 border-b border-border shrink-0" style={{ height: 52 }}>
        <Link href={backHref} className="text-subtle">
          <Icon name="arrowLeft" size={18} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">{title}</span>
        <span className="text-[11px] font-mono text-subtle ml-1">{shortSha}</span>
        {running && (
          <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{ color: 'var(--accent)', background: 'var(--card-2)', border: '1px solid var(--accent)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
            live
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 p-3 lg:p-4">
        {body}
      </div>
    </div>
  )
}
