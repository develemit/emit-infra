'use client'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/icon'

const NAV = [
  { id: 'overview', href: '/', label: 'Overview', icon: 'overview' },
  { id: 'projects', href: '/projects', label: 'Projects', icon: 'projects' },
  { id: 'logs', href: '/logs', label: 'Logs', icon: 'logs' },
  { id: 'ops', href: '/ops', label: 'Ops', icon: 'ops' },
] as const

interface TabBarProps {
  active: string
}

export function TabBar({ active }: TabBarProps) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-elev"
      style={{ height: 64 }}
    >
      {NAV.map(item => (
        <Link
          key={item.id}
          href={item.href}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors',
            'min-w-[44px]',
            item.id === active ? 'text-accent-bright' : 'text-subtle',
          )}
        >
          <Icon name={item.icon} size={21} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  )
}
