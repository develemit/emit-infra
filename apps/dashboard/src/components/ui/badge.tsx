import { cn } from '@/lib/utils'

export type BadgeVariant = 'ok' | 'warn' | 'err' | 'muted' | 'accent' | 'region'

const variantClass: Record<BadgeVariant, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  err: 'bg-err-soft text-err',
  muted: 'bg-card-2 text-subtle',
  accent: 'bg-accent-soft text-accent-bright',
  region: 'bg-elev text-subtle border border-border font-mono',
}

const dotColor: Record<BadgeVariant, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  muted: 'var(--fg-faint)',
  accent: 'var(--accent-bright)',
  region: 'var(--ok)',
}

const dotGlow: Record<BadgeVariant, string> = {
  ok: '0 0 0 3px var(--ok-soft)',
  warn: '0 0 0 3px var(--warn-soft)',
  err: '0 0 0 3px var(--err-soft)',
  muted: 'none',
  accent: '0 0 0 3px var(--accent-soft)',
  region: 'none',
}

interface BadgeProps {
  variant: BadgeVariant
  mono?: boolean
  dot?: boolean
  loading?: boolean
  className?: string
  children: React.ReactNode
}

export function Badge({ variant, mono, dot, loading, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 text-[11px] font-medium rounded',
        variantClass[variant],
        mono && 'font-mono',
        className,
      )}
      style={{ height: 22 }}
    >
      {dot && (
        <span
          className={cn('rounded-full shrink-0', loading && '[animation:ec-pulse_1.4s_ease-in-out_infinite]')}
          style={{
            width: 7,
            height: 7,
            background: dotColor[variant],
            boxShadow: dotGlow[variant],
          }}
        />
      )}
      {children}
    </span>
  )
}
