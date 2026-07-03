'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { getIncidents, annotateIncident, exportIncidents } from '@/lib/api'
import type { Incident } from '@/lib/api'
import { IncidentAnnotationForm } from './incident-annotation-form'

interface Props {
  name: string
}

function ageLabel(ts: number): string {
  const secs = Math.floor((Date.now() / 1000) - ts)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function formatDuration(sec: number | null): string {
  if (sec === null) return 'ongoing'
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
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  async function load() {
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

  useEffect(() => { void load() }, [name])

  async function handleSave(incident: Incident, note: string, falsePositive: boolean) {
    await annotateIncident(name, incident.startedAt, { note, falsePositive })
    setExpanded(null)
    await load()
  }

  const sorted = [...incidents].sort((a, b) => b.startedAt - a.startedAt)

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
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="inline-flex items-center gap-1 px-2 h-[28px] rounded-lg text-[12px] text-subtle hover:text-fg hover:bg-fg/5 transition-colors"
            title="Export incidents"
          >
            <Icon name="download" size={13} />
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-10">
              <button
                onClick={() => { void exportIncidents(name, 'json', 90); setShowExportMenu(false) }}
                className="block w-full text-left px-3 py-2 text-[12px] text-fg hover:bg-fg/5 transition-colors whitespace-nowrap"
              >
                JSON (90d)
              </button>
              <button
                onClick={() => { void exportIncidents(name, 'csv', 90); setShowExportMenu(false) }}
                className="block w-full text-left px-3 py-2 text-[12px] text-fg hover:bg-fg/5 transition-colors whitespace-nowrap border-t border-border"
              >
                CSV (90d)
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">No incidents recorded</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {sorted.map((incident) => (
            <div
              key={incident.startedAt}
              className={incident.falsePositive ? 'opacity-40' : ''}
            >
              <div className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-fg">{ageLabel(incident.startedAt)}</span>
                    <Badge variant={incident.resolved ? 'ok' : 'err'} dot>
                      {incident.resolved ? 'Resolved' : 'Ongoing'}
                    </Badge>
                    {incident.falsePositive && (
                      <Badge variant="muted">false positive</Badge>
                    )}
                    {incident.note && (
                      <span className="font-mono text-[11px] text-subtle truncate max-w-[200px]" title={incident.note}>
                        {incident.note}
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-mono text-[12px] text-subtle shrink-0">
                  {formatDuration(incident.durationSec)}
                </span>
                <button
                  onClick={() => setExpanded(expanded === incident.startedAt ? null : incident.startedAt)}
                  className="text-subtle hover:text-fg transition-colors"
                  title="Annotate"
                >
                  <Icon name="file" size={13} />
                </button>
              </div>
              {expanded === incident.startedAt && (
                <IncidentAnnotationForm
                  initialNote={incident.note ?? ''}
                  initialFalsePositive={incident.falsePositive ?? false}
                  onSave={(note, fp) => handleSave(incident, note, fp)}
                  onCancel={() => setExpanded(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
