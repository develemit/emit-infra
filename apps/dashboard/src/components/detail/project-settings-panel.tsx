'use client'
import { useState, useEffect } from 'react'
import { Icon } from '@/components/icon'
import { updateProjectConfig, getSshKeys, type ProjectSummary } from '@/lib/api'
import { AlertRulesSection } from './alert-rules-section'

interface Props {
  project: ProjectSummary
}

interface SectionState {
  saving: boolean
  saved: boolean
  error: string | null
}

function useSave(fn: () => Promise<void>): [SectionState, () => void] {
  const [state, setState] = useState<SectionState>({ saving: false, saved: false, error: null })
  const save = () => {
    setState({ saving: true, saved: false, error: null })
    fn().then(() => {
      setState({ saving: false, saved: true, error: null })
      setTimeout(() => setState(s => ({ ...s, saved: false })), 2000)
    }).catch((err: unknown) => {
      setState({ saving: false, saved: false, error: err instanceof Error ? err.message : 'Save failed' })
    })
  }
  return [state, save]
}

function SaveButton({ state, onClick }: { state: SectionState; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-3">
      <button
        onClick={onClick}
        disabled={state.saving}
        className="px-3 h-[28px] rounded-lg text-[12px] font-medium bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {state.saving ? 'Saving…' : 'Save'}
      </button>
      {state.saved && <span className="text-[12px] font-mono" style={{ color: 'var(--ok)' }}>Saved</span>}
      {state.error && <span className="text-[12px] font-mono" style={{ color: 'var(--err)' }}>{state.error}</span>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-subtle uppercase tracking-wide">{label}</span>
      {children}
    </div>
  )
}

const inputCls = 'h-[30px] rounded-lg border border-border bg-card-2 px-2 text-[12px] font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent'

export function ProjectSettingsPanel({ project }: Props) {
  const cfg = project.config
  const name = cfg.name

  const [open, setOpen] = useState(false)
  const [sshKeys, setSshKeys] = useState<string[]>([])

  const [serverType, setServerType] = useState(cfg.serverType ?? '')
  const [region, setRegion] = useState<string>(cfg.region ?? '')
  const [domain, setDomain] = useState(cfg.domain ?? '')
  const [serverIp, setServerIp] = useState(cfg.serverIp ?? '')

  const [sshKeyName, setSshKeyName] = useState(cfg.sshKeyName ?? '')

  const [pgVersion, setPgVersion] = useState(cfg.postgres?.version ?? '')
  const [pgBucket, setPgBucket] = useState(cfg.postgres?.backupBucket ?? '')

  const [envKeys, setEnvKeys] = useState((cfg.requiredEnvKeys ?? []).join(', '))

  const [diskPct, setDiskPct] = useState(cfg.warnThresholds?.diskPct ?? 80)
  const [memPct, setMemPct] = useState(cfg.warnThresholds?.memPct ?? 80)
  const [backupAgeHours, setBackupAgeHours] = useState(cfg.warnThresholds?.backupAgeHours ?? 24)

  const [domainError, setDomainError] = useState<string | null>(null)
  const [envKeysError, setEnvKeysError] = useState<string | null>(null)

  useEffect(() => {
    if (open) getSshKeys().then(setSshKeys).catch(() => {})
  }, [open])

  const [serverState, saveServer] = useSave(() => {
    // Validate domain
    if (domain) {
      const domainRe = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/
      if (!domainRe.test(domain)) {
        setDomainError('Invalid domain format')
        return Promise.reject(new Error('Invalid domain format'))
      }
    }
    setDomainError(null)
    return updateProjectConfig(name, { serverType, region, domain, serverIp: serverIp || undefined })
  })
  const [sshState, saveSsh] = useSave(() =>
    updateProjectConfig(name, { sshKeyName }),
  )
  const [dbState, saveDb] = useSave(() =>
    updateProjectConfig(name, { postgres: { version: pgVersion || undefined, backupBucket: pgBucket || undefined } }),
  )
  const [thresholdsState, saveThresholds] = useSave(() =>
    updateProjectConfig(name, { warnThresholds: { diskPct, memPct, backupAgeHours } }),
  )

  const [accessState, saveAccess] = useSave(() => {
    // Validate env keys
    const keys = envKeys.split(',').map(k => k.trim()).filter(Boolean)
    const keyRe = /^[A-Z_][A-Z0-9_]*$/
    const badKey = keys.find(k => !keyRe.test(k))
    if (badKey) {
      setEnvKeysError(`Invalid key: "${badKey}" — must be uppercase with underscores`)
      return Promise.reject(new Error(`Invalid key: "${badKey}" — must be uppercase with underscores`))
    }
    setEnvKeysError(null)
    return updateProjectConfig(name, { requiredEnvKeys: keys })
  })

  return (
    <div id="settings" className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left"
        aria-expanded={open}
        aria-label="Project settings"
      >
        <Icon name="settings" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Settings</span>
        <div className="flex-1" />
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} style={{ color: 'var(--subtle)' }} />
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-6">
          {/* Server */}
          <div>
            <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-3">Server</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Server type"><input className={inputCls} value={serverType} onChange={e => setServerType(e.target.value)} /></Field>
              <Field label="Region"><input className={inputCls} value={region} onChange={e => setRegion(e.target.value)} /></Field>
              <Field label="Domain">
                <input className={inputCls} value={domain} onChange={e => { setDomain(e.target.value); setDomainError(null) }} />
                {domainError && <p className="text-[11px] mt-1" style={{ color: 'var(--err)' }}>{domainError}</p>}
              </Field>
              <Field label="Server IP (optional)"><input className={inputCls} value={serverIp} onChange={e => setServerIp(e.target.value)} /></Field>
            </div>
            <SaveButton state={serverState} onClick={saveServer} />
          </div>

          {/* SSH */}
          <div>
            <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-3">SSH</p>
            <Field label="SSH key">
              {sshKeys.length > 0 ? (
                <select className={inputCls} value={sshKeyName} onChange={e => setSshKeyName(e.target.value)}>
                  {sshKeys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              ) : (
                <input className={inputCls} value={sshKeyName} onChange={e => setSshKeyName(e.target.value)} />
              )}
            </Field>
            <SaveButton state={sshState} onClick={saveSsh} />
          </div>

          {/* Database */}
          <div>
            <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-3">Database</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Postgres version"><input className={inputCls} value={pgVersion} onChange={e => setPgVersion(e.target.value)} /></Field>
              <Field label="Backup bucket"><input className={inputCls} value={pgBucket} onChange={e => setPgBucket(e.target.value)} /></Field>
            </div>
            <SaveButton state={dbState} onClick={saveDb} />
          </div>

          {/* Thresholds */}
          <div>
            <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-3">Thresholds</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Disk warn %">
                <input type="number" min={1} max={100} className={inputCls} value={diskPct}
                  onChange={e => setDiskPct(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 80)))} />
              </Field>
              <Field label="Memory warn %">
                <input type="number" min={1} max={100} className={inputCls} value={memPct}
                  onChange={e => setMemPct(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 80)))} />
              </Field>
              <Field label="Backup age warn (h)">
                <input type="number" min={1} className={inputCls} value={backupAgeHours}
                  onChange={e => setBackupAgeHours(Math.max(1, parseInt(e.target.value, 10) || 24))} />
              </Field>
            </div>
            <SaveButton state={thresholdsState} onClick={saveThresholds} />
          </div>

          {/* Access */}
          <div>
            <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-3">Access</p>
            <Field label="Required env keys (comma-separated)">
              <textarea
                className="rounded-lg border border-border bg-card-2 px-2 py-1.5 text-[12px] font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                rows={3}
                value={envKeys}
                onChange={e => { setEnvKeys(e.target.value); setEnvKeysError(null) }}
              />
              {envKeysError && <p className="text-[11px] mt-1" style={{ color: 'var(--err)' }}>{envKeysError}</p>}
            </Field>
            <SaveButton state={accessState} onClick={saveAccess} />
          </div>

          {/* Alert Rules */}
          <AlertRulesSection project={project} />
        </div>
      )}
    </div>
  )
}
