'use client'
import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiBase } from '@/lib/api'

interface BillingBreakdownItem {
  type: 'server'
  name: string
  serverRate: number
  ipv4Rate: number
  monthlyRate: number
  spendToDate: number
}

interface BillingData {
  month: string
  spendToDate: number
  projectedMonthly: number
  currency: 'EUR'
  breakdown: BillingBreakdownItem[]
  fetchedAt: string
}

const EUR_TO_USD = 1.09

function eur(n: number): string {
  return `€${n.toFixed(2)}`
}

function usd(n: number): string {
  return `$${(n * EUR_TO_USD).toFixed(2)}`
}

export function BillingWidget() {
  const [data, setData] = useState<BillingData | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${getApiBase()}/billing/hetzner`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json: unknown) => {
        if (json && typeof json === 'object' && 'error' in json) {
          setUnavailable(true)
        } else {
          setData(json as BillingData)
        }
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-28 mb-4" />
        <div className="flex gap-6 mb-4">
          <div><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-7 w-24" /></div>
          <div><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-7 w-24" /></div>
        </div>
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  if (unavailable || !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-[13px] font-semibold text-fg mb-1">Hetzner Billing</div>
        <div className="text-[12px] text-subtle font-mono">
          Billing unavailable — set HCLOUD_TOKEN
        </div>
      </div>
    )
  }

  const monthLabel = new Date(data.month + '-01').toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-fg">Hetzner Billing</div>
        <div className="text-[11px] font-mono text-subtle">{monthLabel}</div>
      </div>

      <div className="flex gap-8 mb-4">
        <div>
          <div className="text-[10px] font-mono text-subtle uppercase tracking-wide mb-0.5">
            Spent to date
          </div>
          <div className="text-[20px] font-semibold text-fg tabular-nums leading-tight">
            {eur(data.spendToDate)}
            <span className="text-[12px] text-muted font-normal ml-1">
              ({usd(data.spendToDate)})
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono text-subtle uppercase tracking-wide mb-0.5">
            Projected
          </div>
          <div className="text-[20px] font-semibold text-fg tabular-nums leading-tight">
            {eur(data.projectedMonthly)}
            <span className="text-[12px] text-muted font-normal ml-1">
              ({usd(data.projectedMonthly)})
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        {data.breakdown.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <span className="text-[12px] font-mono text-muted">{item.name}</span>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="text-subtle">
                {eur(item.serverRate)} + {eur(item.ipv4Rate)} IPv4
              </span>
              <span className="text-fg font-semibold">{eur(item.spendToDate)} this month</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
