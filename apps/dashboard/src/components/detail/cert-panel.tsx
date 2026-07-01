'use client'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { getCertDetails, type CertDetails } from '@/lib/api'

interface StatTileProps {
  icon: string
  label: string
  value: string
  mono?: boolean
  color?: string
}

function StatTile({ icon, label, value, mono = true, color }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] text-subtle flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span
        className={`text-[14px] font-semibold${mono ? ' font-mono' : ''}`}
        style={{ letterSpacing: mono ? 0 : undefined, color: color ?? 'var(--fg)' }}
      >
        {value}
      </span>
    </div>
  )
}

function getExpiryColor(daysUntilExpiry: number): string {
  if (daysUntilExpiry < 7) return 'var(--err)'
  if (daysUntilExpiry < 30) return 'var(--warn, #e5a00d)'
  return 'var(--ok, #22c55e)'
}

function extractIssuerField(issuerStr: string): string {
  const match = issuerStr.match(/O=([^,]+)/) || issuerStr.match(/CN=([^,]+)/)
  if (match && match[1]) return match[1]
  return issuerStr
}

function formatShortDate(isoStr: string): string {
  try {
    const d = new Date(isoStr)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return isoStr
  }
}

function getLastRenewedText(isoStr: string | null): string {
  if (!isoStr) return 'Unavailable'
  try {
    const d = new Date(isoStr)
    const daysAgo = Math.floor((Date.now() - d.getTime()) / 86_400_000)
    if (daysAgo === 0) return 'Today'
    if (daysAgo === 1) return '1 day ago'
    return `${daysAgo} days ago`
  } catch {
    return 'Unavailable'
  }
}

export function CertPanel({ name }: { name: string }) {
  const [data, setData] = useState<CertDetails | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await getCertDetails(name)
        setData(result)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [name])

  if (loading || !data) return null

  const expiryColor = getExpiryColor(data.daysUntilExpiry)
  const issuerField = extractIssuerField(data.issuer)
  const serialTrunc = data.serial.substring(0, 12)
  const issuedDate = formatShortDate(data.notBefore)

  return (
    <div className="flex flex-col gap-3 rounded-xl px-4 py-3 border border-border bg-card-2">
      <div className="flex items-center gap-2">
        <Icon name="lock" size={16} />
        <span className="text-[13px] font-semibold text-fg">SSL Certificate</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatTile
          icon="calendar"
          label="Expires"
          value={`${data.daysUntilExpiry}d`}
          color={expiryColor}
        />
        <StatTile
          icon="file"
          label="Issued"
          value={issuedDate}
        />
        <StatTile
          icon="hash"
          label="Serial"
          value={serialTrunc}
        />
        <StatTile
          icon="building"
          label="Issuer"
          value={issuerField}
          mono={false}
        />
      </div>

      {data.sans.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-subtle flex items-center gap-1.5">
            <Icon name="globe" size={13} />
            SANs
          </span>
          <div className="flex flex-wrap gap-2">
            {data.sans.map((san) => (
              <span
                key={san}
                className="px-2 py-1 rounded text-[11px] font-mono bg-card border border-border text-subtle"
              >
                {san}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-subtle">
        Last renewed: {getLastRenewedText(data.renewTimerLastRan)}
      </div>
    </div>
  )
}
