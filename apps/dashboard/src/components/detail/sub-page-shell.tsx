'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/icon'

const SUB_PAGES = [
  { slug: 'networking', label: 'Networking', icon: 'globe' },
  { slug: 'storage', label: 'Storage', icon: 'database' },
  { slug: 'pipelines', label: 'Pipelines', icon: 'zap' },
  { slug: 'reliability', label: 'Reliability', icon: 'shield' },
  { slug: 'data', label: 'Data & Secrets', icon: 'lock' },
  { slug: 'admin', label: 'Administration', icon: 'settings' },
]

interface Props {
  name: string
  title: string
  children: React.ReactNode
}

export function SubPageShell({ name, title, children }: Props) {
  const pathname = usePathname()
  const href = `/projects/${encodeURIComponent(name)}`
  return (
    <div className="flex flex-col min-h-full">
      <div
        className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0"
        style={{ height: 56 }}
      >
        <Link href={href} className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-fg">{title}</span>
          <span className="text-[11px] font-mono text-subtle">{name}</span>
        </div>
      </div>
      <div
        className="lg:hidden sticky top-0 z-40 flex items-center gap-2.5 px-4 border-b border-border bg-elev"
        style={{ height: 52 }}
      >
        <Link href={href} className="text-subtle">
          <Icon name="arrowLeft" size={18} />
        </Link>
        <span className="text-[15px] font-semibold text-fg">{title}</span>
      </div>
      <nav className="flex items-center gap-1 px-2 lg:px-4 border-b border-border overflow-x-auto shrink-0">
        {SUB_PAGES.map(page => {
          const target = `${href}/${page.slug}`
          const active = pathname === target
          return (
            <Link
              key={page.slug}
              href={target}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-2.5 text-[12px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active
                  ? 'text-fg border-fg font-medium'
                  : 'text-subtle border-transparent hover:text-fg'
              }`}
            >
              <Icon name={page.icon} size={13} />
              {page.label}
            </Link>
          )
        })}
      </nav>
      <div className="flex-1 p-4 lg:p-6">
        <div className="flex flex-col gap-4 max-w-[1000px]">
          {children}
        </div>
      </div>
    </div>
  )
}
