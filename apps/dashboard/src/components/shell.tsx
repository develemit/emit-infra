'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutGrid, Server, FileText, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/', icon: LayoutGrid, label: 'Overview' },
  { href: '/projects', icon: Server, label: 'Projects' },
  { href: '/logs', icon: FileText, label: 'Logs' },
  { href: '/ops', icon: Bot, label: 'Ops' },
] as const

function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-800">
          <span className="font-semibold text-sm tracking-tight">emit-infra</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive(href, pathname)
                  ? 'bg-gray-200 dark:bg-gray-800 font-medium text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50',
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main content area */}
      <div className="flex-1 min-w-0 overflow-auto pb-16 lg:pb-0">
        {children}
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex safe-bottom">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors',
              isActive(href, pathname)
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-400 dark:text-gray-500',
            )}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
