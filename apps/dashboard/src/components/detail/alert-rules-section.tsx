'use client'
import { useState } from 'react'
import { Icon } from '@/components/icon'
import { updateProjectConfig, type ProjectSummary, type AlertRule } from '@/lib/api'

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i
const METRICS = ['diskPct', 'memPct', 'certDays', 'backupAgeHours'] as const
const METRIC_LABELS: Record<string, string> = {
  diskPct: 'disk %', memPct: 'memory %', certDays: 'cert days', backupAgeHours: 'backup age (h)',
}

const sel = 'h-[28px] rounded-lg border border-border bg-card-2 px-2 text-[12px] font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent'

export function AlertRulesSection({ project }: { project: ProjectSummary }) {
  const cfg = project.config
  const [rules, setRules] = useState<AlertRule[]>(cfg.alertRules ?? [])
  const [thresholdErrors, setThresholdErrors] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function setRule(i: number, patch: Partial<AlertRule>) {
    setRules(r => r.map((rule, idx) => (idx === i ? { ...rule, ...patch } : rule)))
    if ('threshold' in patch) setThresholdErrors(e => { const n = { ...e }; delete n[i]; return n })
  }

  function removeRule(i: number) {
    setRules(r => r.filter((_, idx) => idx !== i))
    setThresholdErrors(e => { const n = { ...e }; delete n[i]; return n })
  }

  function addRecommended() {
    const existing = new Set(rules.map(r => r.metric))
    const toAdd: AlertRule[] = []
    if (!existing.has('diskPct')) toAdd.push({ metric: 'diskPct', op: 'gt', threshold: 85, enabled: true })
    if (!existing.has('certDays') && DOMAIN_RE.test(cfg.domain)) toAdd.push({ metric: 'certDays', op: 'lt', threshold: 30, enabled: true })
    if (!existing.has('backupAgeHours') && cfg.postgres?.backupBucket) toAdd.push({ metric: 'backupAgeHours', op: 'gt', threshold: 24, enabled: true })
    setRules(r => [...r, ...toAdd])
  }

  function save() {
    const errors: Record<number, string> = {}
    for (let i = 0; i < rules.length; i++) {
      if (!isFinite(rules[i]!.threshold) || rules[i]!.threshold <= 0) errors[i] = 'Must be > 0'
    }
    if (Object.keys(errors).length > 0) { setThresholdErrors(errors); return }
    setSaving(true); setSaved(false); setSaveError(null)
    updateProjectConfig(cfg.name, { alertRules: rules })
      .then(() => { setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000) })
      .catch((err: unknown) => { setSaving(false); setSaveError(err instanceof Error ? err.message : 'Save failed') })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide">Alert Rules</p>
        <div className="flex items-center gap-1">
          <button onClick={addRecommended} className="text-[11px] font-mono px-2 py-0.5 rounded border border-border text-subtle hover:text-fg hover:border-fg/30 transition-colors">+ Recommended</button>
          <button onClick={() => setRules(r => [...r, { metric: 'diskPct', op: 'gt', threshold: 85, enabled: true }])} className="text-[11px] font-mono px-2 py-0.5 rounded border border-border text-subtle hover:text-fg hover:border-fg/30 transition-colors">+ Add rule</button>
        </div>
      </div>

      {rules.length === 0 && (
        <p className="text-[12px] text-subtle font-mono py-2">No alert rules. Add one above or click Recommended.</p>
      )}

      <div className="flex flex-col gap-2">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-start gap-2 flex-wrap">
            <select className={sel} value={rule.metric} onChange={e => setRule(i, { metric: e.target.value as AlertRule['metric'] })}>
              {METRICS.map(m => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
            </select>
            <select className={`${sel} w-12`} value={rule.op} onChange={e => setRule(i, { op: e.target.value as 'gt' | 'lt' })}>
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
            </select>
            <div className="flex flex-col gap-0.5">
              <input type="number" className={`${sel} w-20`} value={rule.threshold}
                onChange={e => setRule(i, { threshold: parseFloat(e.target.value) || 0 })} />
              {thresholdErrors[i] && <p className="text-[10px]" style={{ color: 'var(--err)' }}>{thresholdErrors[i]}</p>}
            </div>
            <label className="flex items-center gap-1 h-[28px] text-[11px] text-subtle font-mono cursor-pointer select-none">
              <input type="checkbox" checked={rule.enabled} onChange={e => setRule(i, { enabled: e.target.checked })} />
              on
            </label>
            <button onClick={() => removeRule(i)} className="flex items-center h-[28px] px-1 text-subtle hover:text-red-400 transition-colors">
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>

      {rules.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <button onClick={save} disabled={saving} className="px-3 h-[28px] rounded-lg text-[12px] font-medium bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50 transition-opacity">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-[12px] font-mono" style={{ color: 'var(--ok)' }}>Saved</span>}
          {saveError && <span className="text-[12px] font-mono" style={{ color: 'var(--err)' }}>{saveError}</span>}
        </div>
      )}
    </div>
  )
}
