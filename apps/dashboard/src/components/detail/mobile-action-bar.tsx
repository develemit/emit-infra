import Link from 'next/link'
import { Icon } from '@/components/icon'

interface MobileActionBarProps {
  name: string
  base: string
  deploying: boolean
  unreachable: boolean
  sheetOpen: boolean
  onDeployClick: () => void
  onSecretsSyncClick: () => void
  onRollbackClick: () => void
  onDestroyClick: () => void
}

// Mirrors ProjectHeader's desktop action set (Logs, Ask Claude, Sync Secrets,
// Rollback, Deploy, Destroy) so mobile never drops an action the desktop header offers.
export function MobileActionBar({
  name,
  base,
  deploying,
  unreachable,
  sheetOpen,
  onDeployClick,
  onSecretsSyncClick,
  onRollbackClick,
  onDestroyClick,
}: MobileActionBarProps) {
  const secondaryDisabled = sheetOpen || unreachable
  const title = unreachable ? "Can't reach the server over SSH" : undefined

  return (
    <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 flex flex-col gap-2 px-4 py-3 border-t border-border bg-elev">
      <button
        onClick={onDeployClick}
        disabled={secondaryDisabled}
        title={title}
        className="flex w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        style={{ height: 48 }}
      >
        <Icon name="deploy" size={16} />{deploying ? 'Running…' : 'Deploy'}
      </button>
      <div className="flex gap-1.5">
        <Link
          href={`${base}/logs`}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
          style={{ height: 44 }}
        >
          <Icon name="file" size={13} />Logs
        </Link>
        <Link
          href={`/ops?project=${encodeURIComponent(name)}`}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
          style={{ height: 44 }}
        >
          <Icon name="zap" size={13} />Claude
        </Link>
        <button
          onClick={onSecretsSyncClick}
          disabled={secondaryDisabled}
          title={title}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl text-[12px] font-medium text-fg border border-border hover:bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ height: 44 }}
        >
          <Icon name="lock" size={13} />Secrets
        </button>
        <button
          onClick={onRollbackClick}
          disabled={secondaryDisabled}
          title={title}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl text-[12px] font-medium text-fg border border-border hover:bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ height: 44 }}
        >
          <Icon name="refresh" size={13} />Rollback
        </button>
        <button
          onClick={onDestroyClick}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl text-[12px] font-medium text-err border border-err-line hover:bg-err-soft transition-colors"
          style={{ height: 44 }}
        >
          <Icon name="trash" size={13} />Destroy
        </button>
      </div>
    </div>
  )
}
