'use client'
import { useParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getStatus, getContainers, getApiBase, type ProjectStatus, type Container } from '@/lib/api'
import { SseOutputPanel } from '@/components/sse-output-panel'
import { DestroyModal } from '@/components/destroy-modal'
import { cn } from '@/lib/utils'

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  const color = pct > 85 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function ProjectDetailPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''
  const apiBase = getApiBase()

  const [status, setStatus] = useState<ProjectStatus | null>(null)
  const [containers, setContainers] = useState<Container[] | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [showDestroy, setShowDestroy] = useState(false)

  const deployUrl = `${apiBase}/projects/${encodeURIComponent(name)}/deploy`

  const fetchData = useCallback(async () => {
    const [s, c] = await Promise.all([getStatus(name), getContainers(name)])
    setStatus(s)
    setContainers(c)
  }, [name])

  useEffect(() => {
    void fetchData()
    const interval = setInterval(() => void fetchData(), 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const disk = status?.disk ? parseInt(status.disk, 10) : null
  const memory = status?.memory ? parseInt(status.memory, 10) : null

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-5"
      >
        <ArrowLeft size={14} />
        Back
      </Link>

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${encodeURIComponent(name)}/logs`}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Logs
          </Link>
          <button
            onClick={() => setShowDestroy(true)}
            className="text-sm px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Destroy
          </button>
        </div>
      </div>

      {status === null ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900" />
          <div className="h-40 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900" />
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-4">
            <h2 className="text-sm font-semibold mb-3">Server</h2>
            {status?.error ? (
              <p className="text-sm text-red-500">Unreachable</p>
            ) : (
              <div className="space-y-3">
                {status?.uptime && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">Uptime: {status.uptime}</p>
                )}
                {disk !== null && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span>Disk</span><span>{disk}%</span>
                    </div>
                    <ProgressBar value={disk} />
                  </div>
                )}
                {memory !== null && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span>Memory</span><span>{memory}%</span>
                    </div>
                    <ProgressBar value={memory} />
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Deploy</h2>
              <button
                onClick={() => setDeploying(true)}
                disabled={deploying}
                className={cn(
                  'text-sm px-3 py-1.5 rounded-lg font-medium',
                  deploying
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90',
                )}
              >
                {deploying ? 'Running...' : 'Deploy'}
              </button>
            </div>
            <SseOutputPanel
              url={deployUrl}
              method="POST"
              active={deploying}
              onComplete={() => setDeploying(false)}
            />
          </section>

          <section className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-semibold">Containers</h2>
            </div>
            {!containers || containers.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No containers found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[360px]">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Name</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 hidden sm:table-cell">Image</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">State</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 hidden sm:table-cell">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {containers.map((c) => (
                      <tr key={c.name}>
                        <td className="px-4 py-3 font-mono text-xs">{c.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[200px]">{c.image}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block text-xs px-2 py-0.5 rounded-full font-medium',
                              c.state === 'running'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                            )}
                          >
                            {c.state}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell">{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {showDestroy && (
        <DestroyModal
          projectName={name}
          apiBase={apiBase}
          onClose={() => setShowDestroy(false)}
        />
      )}
    </div>
  )
}
