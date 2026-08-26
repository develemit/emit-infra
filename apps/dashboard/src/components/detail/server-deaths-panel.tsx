'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { getServerDeaths, type ServerDeathEntry } from '@/lib/api-history'
import { formatDuration } from '@/lib/format-duration'
import { formatTimestamp } from '@/lib/date-helpers'

interface Props {
  name: string
}

function causeLabel(death: ServerDeathEntry): string {
  if (death.reason === 'health-timeout') return 'health check timed out'
  if (death.signal) return `killed by ${death.signal}`
  if (death.exitCode !== null) return `exited ${death.exitCode}`
  return 'exited'
}

export function ServerDeathsPanel({ name }: Props) {
  const [deaths, setDeaths] = useState<ServerDeathEntry[] | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getServerDeaths(name, 20)
      .then(res => { if (!cancelled) setDeaths(res.deaths) })
      .catch(() => { if (!cancelled) setDeaths([]) })
    return () => { cancelled = true }
  }, [name])

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="server" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Server Deaths</span>
        {deaths !== null && deaths.length > 0 && (
          <Badge variant="muted" mono className="ml-1">{deaths.length}</Badge>
        )}
      </div>

      {deaths === null && (
        <div className="flex flex-col gap-1.5">
          {[1, 2].map(i => <div key={i} className="h-[28px] rounded bg-card-2 animate-pulse" />)}
        </div>
      )}

      {deaths !== null && deaths.length === 0 && (
        <p className="text-[12px] font-mono text-subtle py-2">No crashes recorded.</p>
      )}

      {deaths !== null && deaths.length > 0 && (
        <div className="overflow-y-auto" style={{ maxHeight: 580 }}>
          {deaths.map((d, i) => (
            <div key={i} className="py-2.5 border-t border-border first:border-t-0">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="err" dot>{d.reason}</Badge>
                <span className="font-mono text-[12px] text-fg">{causeLabel(d)}</span>
                <span className="font-mono text-[11px] text-subtle">{formatTimestamp(d.ts)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-subtle flex-wrap">
                <span>up {formatDuration(d.uptimeSec)}</span>
                <span className="text-subtle">·</span>
                <span>restart #{d.restartCount}</span>
                {d.host && (
                  <>
                    <span className="text-subtle">·</span>
                    <span>{d.host}</span>
                  </>
                )}
                {d.lastOutput && (
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="text-subtle hover:text-fg transition-colors inline-flex items-center gap-1"
                  >
                    <Icon name={expanded === i ? 'chevDown' : 'chevRight'} size={11} />
                    output
                  </button>
                )}
              </div>
              {expanded === i && d.lastOutput && (
                <pre className="mt-2 p-2 rounded-lg bg-card-2 text-[11px] font-mono text-subtle overflow-x-auto whitespace-pre-wrap max-h-[240px] overflow-y-auto">
                  {d.lastOutput}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
