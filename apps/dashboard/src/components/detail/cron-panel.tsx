'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { getCronJobs, type CronJob } from '@/lib/api'

interface CronPanelProps {
  name: string
}

export function CronPanel({ name }: CronPanelProps) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)

  const fetchJobs = async () => {
    setLoading(true)
    try {
      const data = await getCronJobs(name)
      setJobs(data)
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchJobs()
  }, [name])

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="clock" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Cron Jobs</span>
        <div className="flex-1" />
        <button
          onClick={() => void fetchJobs()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading
            ? <><Icon name="refresh" size={12} />Loading…</>
            : <><Icon name="refresh" size={12} />Refresh</>
          }
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">No cron jobs found</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {jobs.map((job, idx) => (
            <div key={idx} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[12px] font-mono font-bold text-fg">{job.schedule}</span>
                {job.user && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-elev text-subtle">
                    {job.user}
                  </span>
                )}
              </div>
              <div className="text-[12px] font-mono text-fg truncate max-w-[320px]" title={job.command}>{job.command}</div>
              <div className="text-[11px] font-mono text-subtle mt-1">{job.source}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
