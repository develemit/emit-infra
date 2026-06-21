'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AnsiToHtml from 'ansi-to-html'
import { getCiLog, getDeployLog } from '@/lib/api'
import { Terminal } from '@/components/ui/terminal'
import { Icon } from '@/components/icon'

interface Props {
  type: 'ci' | 'deploy'
  name: string
  sha: string
}

const ansiConverter = new AnsiToHtml({ escapeXML: true })

export function RunLogPage({ type, name, sha }: Props) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    const fetchLog = type === 'ci' ? getCiLog : getDeployLog
    fetchLog(name, sha).then(setContent).catch(() => setContent(''))
  }, [type, name, sha])

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
        running={false}
        footer={false}
        scrollBottom
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, minHeight: 0 }}
      >
        {termLines}
      </Terminal>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Desktop topbar */}
      <div className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0" style={{ height: 56 }}>
        <Link href={backHref} className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">{title}</span>
        <span className="text-[12px] font-mono text-subtle">{name} · {shortSha}</span>
      </div>

      {/* Mobile header */}
      <div className="lg:hidden flex items-center gap-2.5 px-4 border-b border-border shrink-0" style={{ height: 52 }}>
        <Link href={backHref} className="text-subtle">
          <Icon name="arrowLeft" size={18} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">{title}</span>
        <span className="text-[11px] font-mono text-subtle ml-1">{shortSha}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 p-3 lg:p-4">
        {body}
      </div>
    </div>
  )
}
