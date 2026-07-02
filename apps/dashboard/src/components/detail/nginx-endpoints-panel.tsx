'use client'
import type { NginxEndpoint } from '@/lib/api'

interface Props {
  available: boolean
  endpoints: NginxEndpoint[]
}

export function NginxEndpointsPanel({ available, endpoints }: Props) {
  if (!available) {
    return (
      <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
        <span className="text-[13.5px] font-semibold text-fg">Top Endpoints</span>
        <p className="text-[12px] text-subtle mt-3">nginx access log not available</p>
      </div>
    )
  }

  const rows = endpoints.slice(0, 10)

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <span className="text-[13.5px] font-semibold text-fg">Top Endpoints</span>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {['Path', 'Requests', 'Errors', 'Error Rate'].map(h => (
                <th
                  key={h}
                  className="text-left text-[11px] font-semibold uppercase tracking-wide text-subtle pb-2"
                  style={{ paddingRight: 12 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(ep => (
              <tr key={ep.path} className="border-t border-border">
                <td
                  className="font-mono text-[12px] text-fg py-2 pr-3 truncate"
                  style={{ maxWidth: 260 }}
                  title={ep.path}
                >
                  {ep.path}
                </td>
                <td className="font-mono text-[12px] text-subtle py-2 pr-3 whitespace-nowrap">
                  {ep.requests.toLocaleString()}
                </td>
                <td className="font-mono text-[12px] text-subtle py-2 pr-3 whitespace-nowrap">
                  {ep.errors.toLocaleString()}
                </td>
                <td
                  className="font-mono text-[12px] py-2 whitespace-nowrap"
                  style={{ color: ep.errorRate > 0.05 ? 'var(--err)' : 'var(--subtle)' }}
                >
                  {(ep.errorRate * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
