'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { getUfwRules, type UfwStatus } from '@/lib/api'

interface UfwPanelProps {
  name: string
}

export function UfwPanel({ name }: UfwPanelProps) {
  const [status, setStatus] = useState<UfwStatus>({ status: 'inactive', rules: [] })
  const [loading, setLoading] = useState(false)

  const fetchRules = async () => {
    setLoading(true)
    try {
      const data = await getUfwRules(name)
      setStatus(data)
    } catch {
      setStatus({ status: 'inactive', rules: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchRules()
  }, [name])

  const statusColor = status.status === 'active' ? 'var(--ok, #22c55e)' : 'var(--warn, #e5a00d)'
  const statusLabel = status.status === 'active' ? 'Active' : 'Inactive'

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="shield" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Firewall</span>
        <div className="flex-1" />
        <span
          className="text-[11px] font-medium px-2 py-1 rounded"
          style={{ color: statusColor, backgroundColor: 'var(--elev)' }}
        >
          {statusLabel}
        </span>
        <button
          onClick={() => void fetchRules()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading
            ? <><Icon name="refresh" size={12} />Loading…</>
            : <><Icon name="refresh" size={12} />Refresh</>
          }
        </button>
      </div>

      {loading && status.rules.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : status.rules.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">No rules configured</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 font-semibold text-subtle">#</th>
                <th className="text-left py-2 px-2 font-semibold text-subtle">To</th>
                <th className="text-left py-2 px-2 font-semibold text-subtle">Action</th>
                <th className="text-left py-2 px-2 font-semibold text-subtle">From</th>
              </tr>
            </thead>
            <tbody>
              {status.rules.map((rule, idx) => {
                const actionColor = rule.action === 'ALLOW' ? 'var(--ok, #22c55e)' : 'var(--err)'
                return (
                  <tr key={idx} className="border-b border-border last:border-b-0">
                    <td className="py-2 px-2 text-fg">{rule.num}</td>
                    <td className="py-2 px-2 text-fg">{rule.to}</td>
                    <td className="py-2 px-2" style={{ color: actionColor }}>
                      {rule.action}
                    </td>
                    <td className="py-2 px-2 text-subtle truncate max-w-[200px]">{rule.from}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
