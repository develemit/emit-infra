import { Icon } from '@/components/icon'
import type { ProjectSummary } from '@/lib/api-projects'
import type { DeployHistoryEntry } from '@/lib/api-history'

interface UnreachableStateProps {
  project: ProjectSummary | null
  deploys: DeployHistoryEntry[]
  onRetry: () => void
}

export function UnreachableState({ project, deploys, onRetry }: UnreachableStateProps) {
  const lastDeploy = deploys[0] ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-err border border-err-line bg-err-soft">
        <Icon name="alert" size={16} />
        <span className="flex-1">SSH unreachable — the server did not respond</span>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 h-[28px] rounded-lg text-[12px] font-medium text-err border border-err-line hover:bg-err-soft transition-colors shrink-0"
        >
          <Icon name="refresh" size={13} />
          Retry
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
        <span className="text-[12px] font-semibold text-subtle uppercase tracking-wide">Last known</span>
        <div className="grid grid-cols-2 gap-4 text-[12px] font-mono">
          <div className="flex flex-col gap-1">
            <span className="text-subtle">Domain</span>
            <span className="text-fg">{project?.config.domain || '—'}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-subtle">IP</span>
            <span className="text-fg">{project?.config.serverIp || '—'}</span>
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <span className="text-subtle">Last deploy</span>
            {lastDeploy ? (
              <span className="text-fg">
                {lastDeploy.sha.slice(0, 7)} · {lastDeploy.status} · {new Date(lastDeploy.completedAt).toLocaleString()}
              </span>
            ) : (
              <span className="text-fg">No deploy history</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
