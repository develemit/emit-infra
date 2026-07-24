'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { getNginxDrift, type NginxDrift } from '@/lib/api-infra'

interface NginxConfigPanelProps {
  name: string
}

function DiffViewer({ diff }: { diff: string[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:text-fg transition-colors"
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        {expanded ? 'Hide diff' : 'Show diff'}
      </button>
      {expanded && (
        <div className="rounded border border-border bg-elev overflow-x-auto">
          <div className="font-mono text-[11px] p-3 space-y-0.5">
            {diff.map((line, idx) => {
              const isAddition = line.startsWith('+')
              const isRemoval = line.startsWith('-')
              const color = isAddition ? 'var(--ok, #22c55e)' : isRemoval ? 'var(--err)' : 'var(--fg)'
              return (
                <div key={idx} style={{ color }}>
                  {line}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function NginxConfigPanel({ name }: NginxConfigPanelProps) {
  const [drift, setDrift] = useState<NginxDrift | null>(null)
  const [loading, setLoading] = useState(false)
  const [unreachable, setUnreachable] = useState(false)

  const fetchDrift = async () => {
    setLoading(true)
    setUnreachable(false)
    try {
      const data = await getNginxDrift(name)
      if (data === null) {
        setUnreachable(true)
      } else {
        setDrift(data)
      }
    } catch {
      setUnreachable(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchDrift()
  }, [name])

  // Don't render if unconfigured
  if (drift?.status === 'unconfigured') {
    return null
  }

  const getStatusBadge = () => {
    if (drift?.status === 'ok') {
      return <Badge variant="ok">Aligned</Badge>
    }
    if (drift?.status === 'drift') {
      return <Badge variant="warn">Drift</Badge>
    }
    if (drift?.status === 'missing-local' || drift?.status === 'missing-server') {
      return <Badge variant="err">Missing</Badge>
    }
    return <Badge variant="muted">Not managed</Badge>
  }

  const getStatusMessage = () => {
    if (unreachable) {
      return 'Unreachable'
    }
    if (loading) {
      return 'Loading…'
    }
    if (!drift) {
      return 'Not managed'
    }
    if (drift.status === 'ok') {
      return 'Vhost config is aligned'
    }
    if (drift.status === 'drift') {
      return 'Vhost config has drifted'
    }
    if (drift.status === 'missing-local') {
      return 'Local config file not found'
    }
    if (drift.status === 'missing-server') {
      return 'Server config file not found'
    }
    return 'Unknown status'
  }

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="globe" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Nginx Config</span>
        <div className="flex-1" />
        {getStatusBadge()}
        <button
          onClick={() => void fetchDrift()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading
            ? <><Icon name="refresh" size={12} />Loading…</>
            : <><Icon name="refresh" size={12} />Refresh</>
          }
        </button>
      </div>

      <div className="text-[12px] text-fg font-mono mb-3">
        {getStatusMessage()}
      </div>

      {drift?.status === 'drift' && 'diff' in drift && (
        <DiffViewer diff={drift.diff} />
      )}
    </div>
  )
}
