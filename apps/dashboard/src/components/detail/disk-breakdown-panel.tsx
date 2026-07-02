'use client'
import type { DiskCategory } from '@/lib/api'
import { Icon } from '@/components/icon'

interface DiskBreakdownPanelProps {
  categories: DiskCategory[]
}

export function DiskBreakdownPanel({ categories }: DiskBreakdownPanelProps) {
  if (categories.length === 0) return null

  const rows = categories.slice(0, 6)

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="database" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Disk by Category</span>
      </div>

      <div className="space-y-2">
        {rows.map(cat => (
          <div key={cat.path} className="flex items-center justify-between">
            <div className="text-[12px] font-mono text-fg truncate flex-1 min-w-0 mr-3">
              {cat.path}
            </div>
            <div className="text-[12px] font-mono text-subtle text-right shrink-0">
              {cat.humanSize}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
