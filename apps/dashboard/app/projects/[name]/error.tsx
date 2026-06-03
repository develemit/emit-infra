'use client'
import Link from 'next/link'
import { Icon } from '@/components/icon'

export default function ProjectDetailError({ error, reset }: { error: Error; reset: () => void }) {
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
        <Icon name="alert" size={32} style={{ color: 'var(--err)' }} />
        <div className="text-[16px] font-semibold text-fg">Something went wrong</div>
        <div className="text-[12px] font-mono text-muted break-all">{error.message}</div>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
          >
            <Icon name="arrowLeft" size={13} />
            Projects
          </Link>
        </div>
      </div>
    </div>
  )
}
