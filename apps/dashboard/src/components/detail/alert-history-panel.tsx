'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { getAlerts, type FiredAlert } from '@/lib/api'

const METRIC_LABELS: Record<string, string> = {
  diskPct: 'disk %', memPct: 'memory %', certDays: 'cert days', backupAgeHours: 'backup age (h)',
}

function relTime(firedAt: number): string {
  const diff = Math.floor(Date.now() / 1000) - firedAt
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function AlertHistoryPanel({ name }: { name: string }) {
  const [alerts, setAlerts] = useState<FiredAlert[] | null>(null)

  useEffect(() => {
    getAlerts(name, 7)
      .then(a => setAlerts([...a].reverse().slice(0, 20)))
      .catch(() => setAlerts([]))
  }, [name])

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="zap" size={15} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Recent Alerts</span>
        <span className="text-[11px] text-subtle font-mono ml-1">7 days</span>
      </div>

      {alerts === null && (
        <div className="flex flex-col gap-1.5">
          {[1, 2].map(i => <div key={i} className="h-[28px] rounded bg-card-2 animate-pulse" />)}
        </div>
      )}

      {alerts !== null && alerts.length === 0 && (
        <p className="text-[12px] font-mono text-subtle py-2">No alerts fired in the last 7 days.</p>
      )}

      {alerts !== null && alerts.length > 0 && (
        <div className="flex flex-col">
          {alerts.map((a, i) => {
            const opLabel = a.op === 'gt' ? '>' : '<'
            const metricLabel = METRIC_LABELS[a.metric] ?? a.metric
            return (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                <span className="text-[12px] font-mono text-fg flex-1">
                  {metricLabel}{' '}
                  <span style={{ color: 'var(--err)' }}>{Math.round(a.value)}</span>
                  {' '}<span className="text-subtle">{opLabel} {a.threshold}</span>
                </span>
                <span className="text-[11px] font-mono text-subtle whitespace-nowrap">{relTime(a.firedAt)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
