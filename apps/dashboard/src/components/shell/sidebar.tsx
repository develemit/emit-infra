'use client'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/icon'

const NAV = [
  { id: 'overview', href: '/', label: 'Overview', icon: 'overview' },
  { id: 'projects', href: '/projects', label: 'Projects', icon: 'projects', count: '6' },
  { id: 'logs', href: '/logs', label: 'Logs', icon: 'logs' },
  { id: 'ci', href: '/ci', label: 'CI', icon: 'zap' },
  { id: 'ops', href: '/ops', label: 'Ops', icon: 'ops' },
] as const

interface SidebarProps {
  active: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function Sidebar({ active, theme, onToggleTheme }: SidebarProps) {
  return (
    <aside
      className="hidden md:flex flex-col shrink-0 border-r border-border bg-elev"
      style={{ width: 232 }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div
          className="flex items-center justify-center rounded-lg shrink-0 text-accent-fg"
          style={{ width: 28, height: 28, background: 'var(--accent)' }}
        >
          <Icon name="zap" size={14} />
        </div>
        <div>
          <div className="text-sm font-semibold text-fg">Emit Infra</div>
          <div className="text-xs text-subtle">develemit</div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map(item => {
          const isActive = item.id === active
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-accent-soft text-accent-bright'
                  : 'text-muted hover:bg-card-hover hover:text-fg',
              )}
            >
              <Icon name={item.icon} size={16} />
              <span className="flex-1">{item.label}</span>
              {'count' in item && item.count && (
                <span className="text-xs rounded-full px-1.5 py-0.5 bg-card-2 text-subtle">
                  {item.count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="flex-1" />

      {/* Bottom controls */}
      <div className="flex flex-col gap-2.5 px-3 pb-5">
        {/* Segmented theme toggle */}
        <div
          className="flex rounded-lg p-0.5"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {(['dark', 'light'] as const).map(t => (
            <button
              key={t}
              onClick={() => t !== theme && onToggleTheme()}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                theme === t ? 'bg-elev text-fg shadow-card' : 'text-subtle',
              )}
            >
              <Icon name={t === 'dark' ? 'moon' : 'sun'} size={12} />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tailscale pill */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <Icon name="shield" size={13} />
          <span>Tailscale</span>
          <span className="flex-1" />
          <span
            className="rounded-full"
            style={{ width: 8, height: 8, background: 'var(--ok)', flexShrink: 0 }}
          />
        </div>
      </div>
    </aside>
  )
}
