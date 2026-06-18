'use client'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import type { DeployHistoryEntry } from '@/lib/api'

interface Props {
  deploys: DeployHistoryEntry[]
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

export function DeployTimeline({ deploys }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="deploy" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Deploy History</span>
        <Badge variant="muted" mono className="ml-1">{deploys.length}</Badge>
      </div>

      {deploys.length === 0 ? (
        <p className="text-sm text-subtle py-2">No deploys recorded.</p>
      ) : (
        <div className="flex flex-col gap-0">
          {deploys.map((d, i) => {
            const failed = d.status === 'failed'
            return (
              <div
                key={i}
                className={`flex items-start gap-3 py-3 border-t border-border first:border-t-0 ${failed ? 'bg-err-soft/30' : ''}`}
              >
                <div className="shrink-0 mt-0.5">
                  <div
                    className="w-2 h-2 rounded-full mt-1"
                    style={{ background: failed ? 'var(--err)' : 'var(--ok, #22c55e)' }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-mono text-[12px] text-fg cursor-pointer hover:underline"
                      title={d.sha}
                      onClick={() => navigator.clipboard.writeText(d.sha)}
                    >
                      {d.sha.slice(0, 7)}
                    </span>
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
