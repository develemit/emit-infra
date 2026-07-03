'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { getFleetIncidents, type FleetProjectData } from '@/lib/api-history'
import { FleetIncidentTimeline } from '@/components/fleet-incident-timeline'

const RANGE_OPTIONS = [1, 7, 30] as const
type Days = typeof RANGE_OPTIONS[number]

function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-7 rounded-lg bg-card border border-border animate-pulse" />
      ))}
    </div>
  )
}

export default function FleetIncidentsPage() {
  const [days, setDays] = useState<Days>(7)
  const [data, setData] = useState<FleetProjectData[] | null>(null)

  useEffect(() => {
    setData(null)
    getFleetIncidents(days).then(setData).catch(() => setData([]))
  }, [days])

  return (
    <div className="min-h-screen">
      {/* Desktop header */}
      <div className="hidden md:flex items-center gap-3 px-8 border-b border-border bg-elev" style={{ height: 56 }}>
        <Link href="/health" className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <Icon name="activity" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">Fleet Incident Timeline</span>
      </div>

      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-2.5 px-4 border-b border-border bg-elev" style={{ height: 52 }}>
        <Link href="/health" className="text-subtle">
          <Icon name="arrowLeft" size={18} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">Fleet Incidents</span>
      </div>

      <div className="px-5 md:px-8 py-5">
        {/* Range selector */}
        <div className="flex items-center gap-1 mb-5">
          {RANGE_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-[12px] font-mono px-3 py-1 rounded-lg border transition-colors ${
                days === d
                  ? 'bg-card-2 border-border text-fg'
                  : 'border-transparent text-subtle hover:text-fg hover:border-border'
              }`}
            >
              {d}d
            </button>
          ))}
          <span className="ml-3 text-[11px] text-subtle font-mono">
            <span className="inline-flex items-center gap-1">
              <span style={{ background: 'var(--err)', borderRadius: 2, display: 'inline-block', width: 10, height: 8 }} />
              incident
            </span>
            {' '}·{' '}
            <span className="inline-flex items-center gap-1">
              <span style={{ background: 'var(--accent)', display: 'inline-block', width: 2, height: 12 }} />
              deploy
            </span>
          </span>
        </div>

        {data === null ? (
          <Skeleton />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden" style={{ padding: 16 }}>
            <FleetIncidentTimeline data={data} days={days} />
          </div>
        )}
      </div>
    </div>
  )
}
