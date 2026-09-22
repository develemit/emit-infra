'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { getPgTableSizes, type PgTable } from '@/lib/api-infra'
import { PanelState } from '@/components/ui/panel-state'
import type { FetchErrorKind } from '@/lib/fetch-result'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRowEstimate(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

interface PgTableSizesPanelProps {
  name: string
}

export function PgTableSizesPanel({ name }: PgTableSizesPanelProps) {
  const [tables, setTables] = useState<PgTable[]>([])
  const [loading, setLoading] = useState(false)
  const [errorKind, setErrorKind] = useState<FetchErrorKind | null>(null)

  const fetchTables = async () => {
    setLoading(true)
    const result = await getPgTableSizes(name)
    if (result.ok) {
      setTables(result.data.slice(0, 10))
      setErrorKind(null)
    } else {
      setTables([])
      setErrorKind(result.kind)
    }
    setLoading(false)
  }

  useEffect(() => {
    void fetchTables()
  }, [name])

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="database" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Table Sizes</span>
        <div className="flex-1" />
        <button
          onClick={() => void fetchTables()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading
            ? <><Icon name="refresh" size={12} />Loading…</>
            : <><Icon name="refresh" size={12} />Refresh</>
          }
        </button>
      </div>

      {loading && tables.length === 0 && !errorKind ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : errorKind ? (
        <PanelState kind={errorKind} />
      ) : tables.length === 0 ? (
        <PanelState kind="empty" />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          <div className="grid grid-cols-3 gap-3 py-2 px-0 text-[11px] text-subtle font-medium mb-1">
            <div>Name</div>
            <div className="text-right">Rows</div>
            <div className="text-right">Size</div>
          </div>
          {tables.map(t => (
            <div key={t.name} className="grid grid-cols-3 gap-3 py-2.5 text-[12px]">
              <span className="font-mono text-fg truncate">{t.name}</span>
              <span className="font-mono text-subtle text-right">{formatRowEstimate(t.rowEstimate)}</span>
              <span className="font-mono text-subtle text-right">{formatBytes(t.totalBytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
