'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { getIncidents } from '@/lib/api'
import type { Incident } from '@/lib/api'

interface Props {
  name: string
}

function ageLabel(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function formatMttr(mttrSec: number | null): string {
  if (mttrSec === null || mttrSec === 0) return '—'
  if (mttrSec < 60) return `${Math.round(mttrSec)}s`
  if (mttrSec < 3600) return `${Math.round(mttrSec / 60)}m`
  return `${(mttrSec / 3600).toFixed(1)}h`
}

export function IncidentPanel({ name }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [mttrSec, setMttrSec] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        const data = await getIncidents(name)
        setIncidents(data.incidents.slice(0, 20))
        setMttrSec(data.mttrSec)
      } catch {
        setIncidents([])
        setMttrSec(null)
      } finally {
        setLoading(false)
      }
    }
    void fetchIncidents()
  }, [name])

  const sorted = [...incidents].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-3">
        <Icon name="alert" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Uptime Incidents</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-subtle">MTTR:</span>
          <span className="text-[12px] font-mono font-semibold text-fg">{formatMttr(mttrSec)}</span>
        </div>
      </div>

      {loading ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">No incidents recorded</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {sorted.map((incident, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-fg">{ageLabel(incident.startedAt)}</span>
                  <Badge variant={incident.resolved ? 'ok' : 'err'} dot>
                    {incident.resolved ? 'Resolved' : 'Ongoing'}
                  </Badge>
                </div>
              </div>
              <span className="font-mono text-[12px] text-subtle shrink-0">
                {incident.resolved ? formatDuration(incident.durationSec) : 'ongoing'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
