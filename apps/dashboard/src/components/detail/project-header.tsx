import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge, type BadgeVariant } from '@/components/ui/badge'

interface ProjectHeaderProps {
  name: string
  domain: string | null
  variant: BadgeVariant
  label: string
  base: string
  deploying: boolean
  onDeployClick: () => void
  onRollbackClick: () => void
  onSecretsSyncClick: () => void
  onDestroyClick: () => void
}

export function ProjectHeader({
  name,
  domain,
  variant,
  label,
  base,
  deploying,
  onDeployClick,
  onRollbackClick,
  onSecretsSyncClick,
  onDestroyClick,
}: ProjectHeaderProps) {
  return (
    <>
      {/* Desktop header */}
      <div
        className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0"
        style={{ height: 56 }}
      >
        <Link href="/" className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-fg">{name}</span>
          {domain && <span className="text-[11px] font-mono text-subtle">{domain}</span>}
        </div>
        <div className="flex-1" />
        <Badge variant={variant} dot loading={variant === 'muted'}>
          {label}
        </Badge>
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <Link
          href={`${base}/logs`}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="file" size={13} />
          Logs
        </Link>
        <Link
          href={`/ops?project=${encodeURIComponent(name)}`}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="zap" size={13} />
          Ask Claude
        </Link>
        <button
          onClick={onSecretsSyncClick}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="lock" size={13} />
          Sync Secrets
        </button>
        <button
          onClick={onRollbackClick}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="refresh" size={13} />
          Rollback
        </button>
        <button
          onClick={onDeployClick}
          disabled={deploying}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Icon name="deploy" size={13} />
          {deploying ? 'Running…' : 'Deploy'}
        </button>
        <button
          onClick={onDestroyClick}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-err border border-err-line hover:bg-err-soft transition-colors"
        >
          <Icon name="trash" size={13} />
          Destroy
        </button>
      </div>

      {/* Mobile header */}
      <div
        className="lg:hidden sticky top-0 z-40 flex items-center gap-2.5 px-4 border-b border-border bg-elev"
        style={{ height: 52 }}
      >
        <Link href="/" className="text-subtle">
          <Icon name="arrowLeft" size={18} />
        </Link>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg truncate">{name}</div>
          {domain && (
            <div className="text-[10.5px] font-mono text-subtle truncate">{domain}</div>
          )}
        </div>
        <div className="flex-1" />
        <Badge variant={variant} dot loading={variant === 'muted'}>
          {label}
        </Badge>
      </div>
    </>
  )
}
