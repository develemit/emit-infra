import Link from 'next/link'
import { Icon } from '@/components/icon'

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div
        className="flex flex-col items-center gap-4 rounded-xl p-8 text-center"
        style={{
          background: 'var(--err-soft)',
          border: '1px solid var(--err-line)',
          maxWidth: 420,
          width: '100%',
        }}
      >
        <Icon name="search" size={32} style={{ color: 'var(--err)' }} />
        <div className="text-[16px] font-semibold text-fg">Page not found</div>
        <div className="text-[12px] font-mono text-muted break-all">
          The page you&apos;re looking for doesn&apos;t exist.
        </div>
        <Link
          href="/"
          className="px-4 py-2 rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
