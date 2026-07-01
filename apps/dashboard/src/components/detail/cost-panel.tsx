'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { getProjectCost } from '@/lib/api'
import type { ProjectCost } from '@/lib/api'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface StatTileProps {
  icon: string
  label: string
  value: string
  subtitle: string
}

function StatTile({ icon, label, value, subtitle }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] text-subtle flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span className="text-[14px] font-semibold font-mono">{value}</span>
      <span className="text-[11px] text-faint">{subtitle}</span>
    </div>
  )
}

interface CostPanelProps {
  name: string
}

export function CostPanel({ name }: CostPanelProps) {
  const [cost, setCost] = useState<ProjectCost | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const data = await getProjectCost(name)
        setCost(data)
      } catch {
        // API unavailable or error
      } finally {
        setLoading(false)
      }
    })()
  }, [name])

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2 mb-4">
          <Icon name="layers" size={16} style={{ color: 'var(--fg-muted)' }} />
          <span className="text-[13.5px] font-semibold text-fg">Estimated Cost</span>
        </div>
        <div className="text-[12px] text-subtle">Loading…</div>
      </div>
    )
  }

  const serverNull = cost?.server === null
  const storageNull = cost?.storage === null

  if (serverNull && storageNull) {
    return (
      <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2 mb-4">
          <Icon name="layers" size={16} style={{ color: 'var(--fg-muted)' }} />
          <span className="text-[13.5px] font-semibold text-fg">Estimated Cost</span>
        </div>
        <div className="text-[12px] text-subtle">Cost data unavailable — set HETZNER_API_TOKEN to enable server pricing.</div>
      </div>
    )
  }

  const serverValue = cost?.server?.eurPerMonth != null ? `€${cost.server.eurPerMonth.toFixed(2)}/mo` : '—'
  const serverSubtitle = cost?.server ? `${cost.server.type} · ${cost.server.region}` : '—'

  const storageValue = cost?.storage?.usdPerMonth != null ? `$${cost.storage.usdPerMonth.toFixed(3)}/mo` : '—'
  const storageSubtitle = cost?.storage ? `${formatBytes(cost.storage.totalBytes)} stored` : '—'

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="layers" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Estimated Cost</span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <StatTile icon="server" label="Server" value={serverValue} subtitle={serverSubtitle} />
        <StatTile icon="database" label="Backups" value={storageValue} subtitle={storageSubtitle} />
      </div>

      <div className="text-[10px] text-faint px-0 py-1">Estimates only. Hetzner: EUR. R2: USD.</div>
    </div>
  )
}
