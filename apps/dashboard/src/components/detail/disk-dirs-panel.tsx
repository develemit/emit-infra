'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { getDiskDirs, type DiskDir } from '@/lib/api'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface DiskDirsPanelProps {
  name: string
}

export function DiskDirsPanel({ name }: DiskDirsPanelProps) {
  const [dirs, setDirs] = useState<DiskDir[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDirs = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getDiskDirs(name)
      setDirs(data)
    } catch (err) {
      setError('Failed to fetch disk usage')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchDirs()
  }, [name])

  const maxBytes = dirs.length > 0 ? Math.max(...dirs.map(d => d.bytes), 1) : 1

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="database" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Disk Usage by Directory</span>
        <div className="flex-1" />
        <button
          onClick={() => void fetchDirs()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading
            ? <><Icon name="refresh" size={12} />Loading…</>
            : <><Icon name="refresh" size={12} />Refresh</>
          }
        </button>
      </div>

      {error && (
        <div className="text-[12px] px-3 py-2 rounded-lg border" style={{ color: 'var(--err)', borderColor: 'var(--border)', background: 'var(--card-2)' }}>
          {error}
        </div>
      )}

      {dirs.length > 0 ? (
        <div className="space-y-3">
          {dirs.map(dir => {
            const pct = (dir.bytes / maxBytes) * 100
            return (
              <div key={dir.path} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-mono text-fg truncate">{dir.path}</div>
                  <div className="h-2 rounded-full mt-1.5 bg-card-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: 'var(--fg-muted)' }}
                    />
                  </div>
                </div>
                <div className="text-[12px] font-mono text-subtle text-right shrink-0" style={{ minWidth: 60 }}>
                  {formatBytes(dir.bytes)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-subtle font-mono text-[12px]">No directory data yet</div>
      )}
    </div>
  )
}
