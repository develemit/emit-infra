'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { getResponseTimes, type ResponseTimes } from '@/lib/api'

interface StatTileProps {
  icon: string
  label: string
  value: string
  mono?: boolean
  color?: string
}

function StatTile({ icon, label, value, mono = true, color }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] text-subtle flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span
        className={`text-[14px] font-semibold${mono ? ' font-mono' : ''}`}
        style={{ letterSpacing: mono ? 0 : undefined, color: color ?? 'var(--fg)' }}
      >
        {value}
      </span>
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function ResponseTimePanel({ name }: { name: string }) {
  const [data, setData] = useState<ResponseTimes | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await getResponseTimes(name)
        setData(result)
      } catch {
        setData({ available: false })
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [name])

  if (loading || !data || !data.available) return null

  const getP99Color = (ms: number): string => {
    if (ms > 2000) return 'var(--err)'
    if (ms > 500) return 'var(--warn, #e5a00d)'
    return 'var(--fg)'
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl px-4 py-3 border border-border bg-card-2">
      <div className="flex items-center gap-2">
        <Icon name="activity" size={16} />
        <span className="text-[13px] font-semibold text-fg">Response Times (24h)</span>
      </div>
      <div className="flex gap-6">
        <StatTile icon="zap" label="P50" value={formatMs(data.p50ms)} />
        <StatTile icon="gauge" label="P95" value={formatMs(data.p95ms)} />
        <StatTile icon="alert" label="P99" value={formatMs(data.p99ms)} color={getP99Color(data.p99ms)} />
      </div>
      <span className="text-[11px] text-subtle">Based on {data.sampleCount.toLocaleString()} requests</span>
    </div>
  )
}
