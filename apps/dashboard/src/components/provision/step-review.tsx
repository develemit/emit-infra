import { Icon } from '@/components/icon'
import type { FormValues } from './types'

const SERVER_PRICE: Record<string, string> = {
  cx22: '4.59', cx32: '7.49', cx42: '16.40',
}
const SERVER_SPEC: Record<string, string> = {
  cx22: 'cx22 · 2 vCPU · 4 GB', cx32: 'cx32 · 4 vCPU · 8 GB', cx42: 'cx42 · 8 vCPU · 16 GB',
}

interface Props {
  values: FormValues
  onNext: () => void
  onBack: () => void
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-b-0">
      <span className="text-[13px] text-muted">{k}</span>
      <span className="text-[13px] font-mono text-fg text-right max-w-[240px] truncate">{v}</span>
    </div>
  )
}

export function StepReview({ values, onNext, onBack }: Props) {
  const price = SERVER_PRICE[values.serverType] ?? '—'
  const spec = SERVER_SPEC[values.serverType] ?? values.serverType

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card" style={{ padding: '4px 16px' }}>
        <KV k="Name" v={values.name} />
        <KV k="Domain" v={values.domain} />
        <KV k="GitHub" v={values.githubRepo} />
        <KV k="Region" v={values.region} />
        <KV k="Server" v={spec} />
        <KV k="SSH key" v={values.sshKey || 'emit-deploy'} />
        <KV k="R2 buckets" v={values.r2Buckets.length > 0 ? values.r2Buckets.join(', ') : 'none'} />
        <KV k="Redis" v={values.redis ? 'enabled' : 'disabled'} />
        <KV k="Postgres" v={values.postgres ? `enabled · backup → ${values.postgresBucket || '(no bucket set)'}` : 'disabled'} />
      </div>

      <div
        className="flex items-start gap-2.5 rounded-lg p-3 text-[12.5px] text-muted"
        style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}
      >
        <Icon name="alert" size={15} style={{ color: 'var(--accent-bright)', flexShrink: 0, marginTop: 1 }} />
        <span>
          Provisioning creates billable infrastructure on Hetzner, Cloudflare and Upstash.{' '}
          Est. <strong className="font-mono text-fg">€{price}/mo</strong>.
        </span>
      </div>

      {/* Desktop nav */}
      <div className="hidden lg:flex items-center gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors">
          <Icon name="arrowLeft" size={14} />Back
        </button>
        <div className="flex-1" />
        <button onClick={onNext} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity">
          <Icon name="deploy" size={14} />Provision
        </button>
      </div>
    </div>
  )
}
