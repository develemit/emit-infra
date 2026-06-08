'use client'

import { useEffect, useState, useCallback } from 'react'
import { Icon } from '@/components/icon'
import { getDockerUsage, pruneDocker, type DockerUsageRow } from '@/lib/api'

function isReclaimable(s: string): boolean {
  const trimmed = s.trim()
  if (!trimmed || trimmed === '0B' || trimmed === '0B (0%)') return false
  return true
}

function reclaimableLabel(s: string): string {
  const match = s.match(/^(.+?)\s*\(\d+%\)$/)
  return match ? match[1]! : s.trim()
}

function UsageRow({ row }: { row: DockerUsageRow }) {
  const canReclaim = isReclaimable(row.reclaimable)

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-fg">{row.type}</span>
        <span className="text-[11px] font-mono text-subtle">
          {row.active}/{row.total} active
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[13px] font-mono text-fg">{row.size}</span>
        {canReclaim && (
          <span className="text-[11px] font-mono text-warn">
            {reclaimableLabel(row.reclaimable)} reclaimable
          </span>
        )}
      </div>
    </div>
  )
}

interface Props {
  projectName: string
  onPrune?: () => void
}

export function DockerUsage({ projectName, onPrune }: Props) {
  const [rows, setRows] = useState<DockerUsageRow[] | null>(null)
  const [pruning, setPruning] = useState(false)
  const [pruneResult, setPruneResult] = useState<string | null>(null)

  const fetchUsage = useCallback(async () => {
    try {
      setRows(await getDockerUsage(projectName))
    } catch {
      setRows(null)
    }
  }, [projectName])

  useEffect(() => { void fetchUsage() }, [fetchUsage])

  const handlePrune = async () => {
    setPruning(true)
    setPruneResult(null)
    try {
      const res = await pruneDocker(projectName)
      setPruneResult(res.output)
      await fetchUsage()
      onPrune?.()
    } catch {
      setPruneResult('Prune failed — check SSH connectivity.')
    } finally {
      setPruning(false)
    }
  }

  const hasReclaimable = rows?.some(r => isReclaimable(r.reclaimable))

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="database" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Docker Resources</span>
        <div className="flex-1" />
        {hasReclaimable && (
          <button
            onClick={handlePrune}
            disabled={pruning}
            className="inline-flex items-center gap-1.5 px-2.5 h-[28px] rounded-lg text-[11px] font-medium text-warn border border-warn-line hover:bg-warn-soft disabled:opacity-50 transition-colors"
          >
            <Icon name="trash" size={12} />
            {pruning ? 'Pruning…' : 'Prune'}
          </button>
        )}
      </div>

      {rows === null ? (
        <p className="text-sm text-subtle py-2">Could not load Docker usage.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-subtle py-2">No Docker resources found.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map(r => <UsageRow key={r.type} row={r} />)}
        </div>
      )}

      {pruneResult && (
        <pre className="mt-3 p-3 rounded-lg bg-elev text-[11px] font-mono text-subtle overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">
          {pruneResult}
        </pre>
      )}
    </div>
  )
}
