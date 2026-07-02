'use client'

import type { SlaData } from '@/lib/api'

interface SlaStatProps {
  label: string
  value: number
}

function SlaStat({ label, value }: SlaStatProps) {
  let color = 'var(--err)'
  if (value >= 99.9) color = 'var(--ok)'
  else if (value >= 99) color = 'var(--warn)'

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-medium text-subtle uppercase tracking-wide">{label}</div>
      <div style={{ color }} className="text-[20px] font-semibold font-mono">
        {value.toFixed(2)}%
      </div>
    </div>
  )
}

interface SlaPanelProps {
  sla: SlaData
}

export function SlaPanel({ sla }: SlaPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col sm:flex-row gap-6">
        <SlaStat label="7-day uptime" value={sla.uptime7d} />
        <SlaStat label="30-day uptime" value={sla.uptime30d} />
      </div>
    </div>
  )
}
