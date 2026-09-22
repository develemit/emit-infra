'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import AnsiToHtml from 'ansi-to-html'
import { getCiLog, getDeployLog } from '@/lib/api-history'
import { getCiStatus, getDeployStatus } from '@/lib/api-containers'
import { stripAnsi, filterLines, logFilename, splitByMatch } from '@/lib/log-text'
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

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function RunLogPage({ type, name, sha }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [predatesCapture, setPredatesCapture] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const running = useRunningState(type, name)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchLog = useCallback(() => {
    const fn = type === 'ci' ? getCiLog : getDeployLog
    fn(name, sha)
      .then(result => {
        setContent(result.content)
        setPredatesCapture(result.predatesCapture)
        setLoaded(true)
      })
      .catch(() => { setContent(null); setPredatesCapture(false); setLoaded(true) })
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

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])

  const title = type === 'ci' ? 'CI Log' : 'Deploy Log'
  const backHref = `/projects/${encodeURIComponent(name)}`
  const shortSha = sha.slice(0, 7)

  const plainText = content !== null ? stripAnsi(content) : ''
  const plainLines = content !== null ? plainText.split('\n') : []
  const htmlLines = content !== null ? ansiConverter.toHtml(content).split('\n') : []
  const isFiltering = filterQuery.trim() !== ''
  const visibleIndexes = filterLines(plainLines, filterQuery)

  function handleCopy() {
    void navigator.clipboard.writeText(plainText).then(() => setCopied(true))
  }

  function handleDownload() {
    downloadText(logFilename(name, type, sha), plainText)
  }

  const toolbar = content !== null && (
    <>
      <div className="relative w-full max-w-[200px]">
        <input
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter log lines"
          className="w-full h-[30px] pl-7 pr-2 rounded-lg text-[12px] font-mono text-fg bg-card border border-border focus:outline-none focus:border-accent"
        />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-subtle pointer-events-none">
          <Icon name="search" size={12} />
        </span>
      </div>
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 px-2.5 h-[30px] rounded-lg text-[12px] font-medium text-subtle border border-border hover:text-fg transition-colors shrink-0"
      >
        <Icon name="copy" size={13} />{copied ? 'Copied' : 'Copy'}
      </button>
      <button
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 px-2.5 h-[30px] rounded-lg text-[12px] font-medium text-subtle border border-border hover:text-fg transition-colors shrink-0"
      >
        <Icon name="download" size={13} />Download
      </button>
    </>
  )

  let body: React.ReactNode
  if (!loaded) {
    body = (
      <div className="flex items-center justify-center h-full text-[12px] font-mono text-subtle">
        loading…
      </div>
    )
  } else if (content === null) {
    body = (
      <div className="flex items-center justify-center h-full text-[12px] font-mono text-subtle text-center px-6">
        {predatesCapture ? 'Log not available — this run predates log capture' : 'No log found for this run'}
      </div>
    )
  } else {
    const termLines = visibleIndexes.map(i => (
      <div key={i} className="ec-ln">
        {isFiltering
          ? splitByMatch(plainLines[i] ?? '', filterQuery).map((seg, j) => (
            seg.match
              ? <mark key={j} className="ec-log-mark">{seg.text}</mark>
              : <span key={j}>{seg.text}</span>
          ))
          : <span dangerouslySetInnerHTML={{ __html: htmlLines[i] ?? '' }} />}
      </div>
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
        <div className="flex-1" />
        {toolbar}
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
      {content !== null && (
        <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          {toolbar}
        </div>
      )}

      <div className="flex-1 min-h-0 p-3 lg:p-4">
        {body}
      </div>
    </div>
  )
}
