'use client'
import React from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import type { Container } from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { useRestartConfirm } from '@/lib/use-restart-confirm'
import { stateBadge, buildLabel, type ContainerMetrics } from './container-row-utils'

export function MobileContainerRow({
  c,
  logsHref,
  projectName,
  onRefetch,
  metrics,
}: {
  c: Container
  logsHref: string
  projectName: string
  onRefetch?: () => void
  metrics?: ContainerMetrics
}) {
  const { showToast } = useToast()
  const { restarting, confirming, setConfirming, handleRestart } = useRestartConfirm({
    projectName,
    containerName: c.name,
    showToast,
    onRefetch,
  })
  const variant = stateBadge(c.state)

  return (
    <div
      className="rounded-xl border border-border bg-card flex flex-col gap-1.5"
      style={{ padding: 12 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-[13px] text-fg">{c.name}</span>
        <div className="flex items-center gap-2">
          <Badge variant={variant} dot>{c.state}</Badge>
          {confirming ? (
            <>
              <button
                onClick={() => void handleRestart()}
                className="text-[11px] font-mono transition-colors"
                style={{ color: 'var(--warn)' }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-[11px] font-mono text-subtle transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={restarting}
              className="text-subtle hover:text-fg transition-colors disabled:opacity-40"
              title="Restart container"
            >
              <Icon name="refresh" size={13} />
            </button>
          )}
          <Link href={logsHref} className="text-subtle hover:text-fg transition-colors">
            <Icon name="file" size={13} />
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="font-mono text-[11px] text-subtle truncate flex-1">{c.image}</div>
        <span className="font-mono text-[11px] text-faint shrink-0">{buildLabel(c)}</span>
      </div>
      <div className="font-mono text-[11px] text-faint">{c.status}</div>
      {metrics && (
        <div className="flex items-center gap-3 text-[11px] font-mono text-subtle mt-0.5">
          <span>CPU {metrics.cpu.toFixed(1)}%</span>
          <span>{metrics.memMb.toFixed(0)} MB</span>
          {metrics.restarts > 0 && (
            <span style={{ color: 'var(--err)' }}>{metrics.restarts} restarts</span>
          )}
        </div>
      )}
    </div>
  )
}
