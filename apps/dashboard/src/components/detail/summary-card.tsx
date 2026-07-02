import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'

interface Stat {
  label: string
  value: string
  color?: string
}

interface Props {
  icon: string
  title: string
  href: string
  stats?: Stat[]
  badge?: { variant: 'ok' | 'warn' | 'err' | 'muted' | 'accent'; label: string }
  hidden?: boolean
}

export function SummaryCard({ icon, title, href, stats, badge, hidden }: Props) {
  if (hidden) return null
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-card hover:bg-card-hover transition-colors"
      style={{ padding: 18, textDecoration: 'none' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon name={icon} size={15} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">{title}</span>
        <div className="flex-1" />
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        <Icon name="chevRight" size={14} style={{ color: 'var(--fg-muted)' }} />
      </div>
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {stats.map(stat => (
            <div key={stat.label} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-subtle">{stat.label}</span>
              <span
                className="text-[13px] font-mono font-medium"
                style={{ color: stat.color ?? 'var(--fg)' }}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}
