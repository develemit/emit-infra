import Link from 'next/link'
import { Icon } from '@/components/icon'

interface Props {
  name: string
  title: string
  children: React.ReactNode
}

export function SubPageShell({ name, title, children }: Props) {
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
      <div className="flex-1 p-4 lg:p-6">
        <div className="flex flex-col gap-4 max-w-[1000px]">
          {children}
        </div>
      </div>
    </div>
  )
}
