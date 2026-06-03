'use client'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/hooks/use-theme'
import { Sidebar } from './sidebar'
import { TabBar } from './tab-bar'

function pathToActive(pathname: string): string {
  if (pathname === '/') return 'overview'
  if (pathname.startsWith('/projects')) return 'projects'
  if (pathname.startsWith('/logs')) return 'logs'
  if (pathname.startsWith('/ops')) return 'ops'
  if (pathname.startsWith('/provision')) return 'projects'
  return 'overview'
}

interface ShellProps {
  children: React.ReactNode
}

export function Shell({ children }: ShellProps) {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const active = pathToActive(pathname)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar active={active} theme={theme} onToggleTheme={toggleTheme} />

      <main className="flex-1 min-w-0 overflow-auto pb-16 md:pb-0">
        {children}
      </main>

      <TabBar active={active} />
    </div>
  )
}
