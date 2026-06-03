import { Icon } from '@/components/icon'
import { ChipInput } from '@/components/ui/chip-input'
import { Switch } from '@/components/ui/switch'
import type { FormValues } from './types'

const REGIONS = ['nbg1', 'fsn1', 'hel1', 'ash', 'hil']
const SERVER_TYPES = [
  { id: 'cx22', cpu: '2 vCPU', ram: '4 GB', disk: '40 GB', price: '€4.59' },
  { id: 'cx32', cpu: '4 vCPU', ram: '8 GB', disk: '80 GB', price: '€7.49' },
  { id: 'cx42', cpu: '8 vCPU', ram: '16 GB', disk: '160 GB', price: '€16.40' },
]

interface Props {
  values: FormValues
  onChange: (patch: Partial<FormValues>) => void
  onNext: () => void
  onBack: () => void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[13px] font-medium text-fg block mb-1">{children}</label>
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-[36px] pl-3 pr-8 rounded-lg text-[12.5px] font-mono text-fg bg-card border border-border appearance-none focus:outline-none focus:border-accent transition-colors"
      >
        {children}
      </select>
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle pointer-events-none">
        <Icon name="chevDown" size={13} />
      </span>
    </div>
  )
}

export function StepInfrastructure({ values, onChange, onNext, onBack }: Props) {
  return (
    <div className="flex flex-col gap-[18px]">
      {/* Region + SSH key row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Region</FieldLabel>
          <Select value={values.region} onChange={v => onChange({ region: v })}>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <div>
          <FieldLabel>SSH key</FieldLabel>
          <Select value={values.sshKey} onChange={v => onChange({ sshKey: v })}>
            <option value="emit-deploy">emit-deploy</option>
          </Select>
        </div>
      </div>

      {/* Server type */}
      <div>
        <FieldLabel>Server type</FieldLabel>
        <div className="flex flex-col gap-2">
          {SERVER_TYPES.map(t => {
            const selected = values.serverType === t.id
            return (
              <label
                key={t.id}
                className="flex items-center gap-3 rounded-xl cursor-pointer transition-colors"
                style={{
                  padding: '11px 14px',
                  border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  background: selected ? 'var(--accent-soft)' : 'var(--card)',
                }}
              >
                <input type="radio" className="sr-only" name="serverType" value={t.id} checked={selected} onChange={() => onChange({ serverType: t.id })} />
                <span
                  className="flex items-center justify-center rounded-full shrink-0"
                  style={{
                    width: 16, height: 16,
                    border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
                  }}
                >
                  {selected && <span className="rounded-full" style={{ width: 7, height: 7, background: 'var(--accent)' }} />}
                </span>
                <span className="font-mono font-semibold text-[13.5px] text-fg" style={{ minWidth: 40 }}>{t.id}</span>
                <span className="font-mono text-[12px] text-subtle">{t.cpu} · {t.ram} · {t.disk}</span>
                <span className="flex-1" />
                <span className="font-mono text-[12px] text-muted">{t.price}/mo</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* R2 buckets */}
      <div>
        <FieldLabel>R2 buckets</FieldLabel>
        <ChipInput values={values.r2Buckets} onChange={v => onChange({ r2Buckets: v })} placeholder="add bucket…" />
        <span className="text-[11.5px] font-mono text-subtle mt-1 block">optional — press Enter to add</span>
      </div>

      {/* Redis toggle */}
      <div
        className="flex items-center gap-3 rounded-xl"
        style={{ padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <Icon name="zap" size={16} style={{ color: 'var(--accent-bright)', flexShrink: 0 }} />
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-fg">Upstash Redis</div>
          <div className="text-[11.5px] text-subtle">Provision a managed Redis database</div>
        </div>
        <Switch on={values.redis} onChange={() => onChange({ redis: !values.redis })} />
      </div>

      {/* Desktop nav buttons */}
      <div className="hidden lg:flex items-center gap-2 mt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors">
          <Icon name="arrowLeft" size={14} />Back
        </button>
        <div className="flex-1" />
        <button onClick={onNext} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity">
          Continue <Icon name="chevRight" size={14} />
        </button>
      </div>
    </div>
  )
}
