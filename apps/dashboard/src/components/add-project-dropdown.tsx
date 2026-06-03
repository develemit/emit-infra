'use client'
import { useEffect, useRef, useState } from 'react'
import { getUnregistered, registerProject } from '@/lib/api'
import { Icon } from '@/components/icon'

interface Props {
  onRegistered: () => void
}

export function AddProjectDropdown({ onRegistered }: Props) {
  const [open, setOpen] = useState(false)
  const [dirs, setDirs] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [repo, setRepo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    getUnregistered().then(setDirs).catch(() => setDirs([]))
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSelected(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function pick(name: string) {
    setSelected(name)
    setDomain('')
    setRepo(`develemit/${name}`)
    setError('')
  }

  async function submit() {
    if (!selected) return
    if (!domain) { setError('Domain is required'); return }
    if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { setError('Repo must be owner/repo'); return }
    setSubmitting(true)
    try {
      await registerProject(selected, { domain, github: { repo } })
      setOpen(false)
      setSelected(null)
      onRegistered()
    } catch {
      setError('Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); setSelected(null) }}
        className="inline-flex items-center gap-1.5 px-3 h-[34px] rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
      >
        <Icon name="plus" size={15} />
        Add Project
        <Icon name="chevDown" size={13} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[320px] rounded-xl border border-border bg-elev shadow-lg overflow-hidden">
          {!selected ? (
            <>
              <div className="px-3 pt-3 pb-2 text-[11.5px] font-mono text-subtle uppercase tracking-wider">
                Unregistered projects
              </div>
              {dirs === null ? (
                <div className="px-3 pb-3 text-[12px] text-subtle">Loading...</div>
              ) : dirs.length === 0 ? (
                <div className="px-3 pb-3 text-[12px] text-subtle">All projects are registered.</div>
              ) : (
                <div className="max-h-[240px] overflow-auto">
                  {dirs.map((d) => (
                    <button
                      key={d}
                      onClick={() => pick(d)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-fg hover:bg-card-hover transition-colors text-left"
                    >
                      <Icon name="box" size={14} className="text-subtle shrink-0" />
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="p-3 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="text-subtle hover:text-fg">
                  <Icon name="arrowLeft" size={14} />
                </button>
                <span className="text-[13px] font-semibold text-fg">{selected}</span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-fg">Domain / IP</label>
                <input
                  value={domain}
                  onChange={(e) => { setDomain(e.target.value); setError('') }}
                  placeholder="192.168.1.1 or app.example.com"
                  className="w-full px-2.5 py-1.5 rounded-lg text-[12px] font-mono text-fg bg-card border border-border focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-fg">GitHub repo</label>
                <input
                  value={repo}
                  onChange={(e) => { setRepo(e.target.value); setError('') }}
                  placeholder="owner/repo"
                  className="w-full px-2.5 py-1.5 rounded-lg text-[12px] font-mono text-fg bg-card border border-border focus:outline-none focus:border-accent"
                />
              </div>

              {error && <span className="text-[11px] text-err">{error}</span>}

              <button
                onClick={submit}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? 'Registering...' : 'Register'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
