'use client'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import type { DeployHistoryEntry } from '@/lib/api'

interface Props {
  deploys: DeployHistoryEntry[]
  name: string
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function DeployTimeline({ deploys, name }: Props) {
  const total = deploys.length
  const successes = deploys.filter(d => d.status === 'deployed').length
  const avgSec = total > 0 ? Math.round(deploys.reduce((a, d) => a + d.durationSec, 0) / total) : 0
  const lastSec = deploys[0]?.durationSec ?? 0
  const rateColor = total === 0 || successes / total >= 0.9
    ? 'var(--ok, #22c55e)'
    : successes / total >= 0.7 ? '#f59e0b' : 'var(--err)'

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="deploy" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Deploy History</span>
        <Badge variant="muted" mono className="ml-1">{total}</Badge>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-3 mb-3 text-[10px] font-mono flex-wrap">
          <span style={{ color: rateColor }}>{successes}/{total} succeeded</span>
          <span className="text-subtle">·</span>
          <span className="text-subtle">avg {formatDuration(avgSec)}</span>
          <span className="text-subtle">·</span>
          <span className="text-subtle">last {formatDuration(lastSec)}</span>
        </div>
      )}

      {total === 0 ? (
        <p className="text-sm text-subtle py-2">No deploys recorded.</p>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: 580 }}>
          {deploys.map((d, i) => {
            const failed = d.status === 'failed'
            return (
              <Link
                key={i}
                href={`/projects/${encodeURIComponent(name)}/deploy-log/${d.sha}`}
                className={`flex items-start gap-3 py-3 border-t border-border first:border-t-0 transition-colors ${failed ? 'bg-err-soft/30 hover:bg-err-soft/50' : 'hover:bg-card-hover'}`}
              >
                <div className="shrink-0 mt-0.5">
                  <div
                    className="w-2 h-2 rounded-full mt-1"
                    style={{ background: failed ? 'var(--err)' : 'var(--ok, #22c55e)' }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-fg">
                      {d.sha.slice(0, 7)}
                    </span>
                    <button
                      type="button"
                      className="text-subtle hover:text-fg transition-colors"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); void navigator.clipboard.writeText(d.sha) }}
                    >
                      <Icon name="copy" size={11} />
                    </button>
                    {d.branch && (
                      <span className="font-mono text-[11px] text-subtle truncate max-w-[120px]">{d.branch}</span>
                    )}
                    <Badge variant={failed ? 'err' : 'ok'} dot>{d.status}</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-subtle flex-wrap">
                    <span>{formatTimestamp(d.completedAt)}</span>
                    <span>{formatDuration(d.durationSec)}</span>
                    {d.servicesBuilt.length > 0 && (
                      <span className="truncate max-w-[200px]">{d.servicesBuilt.join(', ')}</span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
