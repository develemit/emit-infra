'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { getSecretsDrift, applySecrets, type SecretsDrift } from '@/lib/api'

interface SecretsPanelProps {
  name: string
}

export function SecretsPanel({ name }: SecretsPanelProps) {
  const [drift, setDrift] = useState<SecretsDrift | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const fetchDrift = async () => {
    setLoading(true)
    try {
      const data = await getSecretsDrift(name)
      setDrift(data)
    } catch {
      setDrift(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    const result = await applySecrets(name)
    setSyncing(false)
    if (result.ok) {
      setSynced(true)
      setTimeout(() => setSynced(false), 2000)
      void fetchDrift()
    } else {
      setSyncError(result.error ?? 'Sync failed')
    }
  }

  useEffect(() => {
    void fetchDrift()
  }, [name])

  // Don't render if unconfigured
  if (drift === null || drift.status === 'unconfigured') {
    return null
  }

  const missing = drift.missing ?? []
  const extra = drift.extra ?? []
  const present = drift.present ?? []

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="lock" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Secrets</span>
        <div className="flex-1" />
        <span className="text-[12px] text-subtle font-mono mr-3">
          {missing.length} missing · {extra.length} extra · {present.length} present
        </span>
        {missing.length > 0 && (
          <button
            onClick={() => void handleSync()}
            disabled={syncing || synced}
            className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-ok-fg bg-ok hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {syncing
              ? <><Icon name="refresh" size={12} />Syncing…</>
              : synced
              ? <><Icon name="check" size={12} />Synced!</>
              : <><Icon name="deploy" size={12} />Sync to server</>
            }
          </button>
        )}
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

      {syncError && (
        <div className="text-[12px] text-err font-mono mb-2">{syncError}</div>
      )}

      {loading ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : (
        <div className="flex flex-col gap-4">
          {missing.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-err uppercase tracking-wide">Missing Keys</span>
              <div className="flex flex-wrap gap-2">
                {missing.map(key => (
                  <Badge key={key} variant="err">{key}</Badge>
                ))}
              </div>
            </div>
          )}

          {extra.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-warn uppercase tracking-wide">Extra Keys</span>
              <div className="flex flex-wrap gap-2">
                {extra.map(key => (
                  <Badge key={key} variant="warn">{key}</Badge>
                ))}
              </div>
            </div>
          )}

          {present.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-ok uppercase tracking-wide">Present Keys</span>
              <div className="flex flex-wrap gap-2">
                {present.map(key => (
                  <Badge key={key} variant="ok">{key}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
