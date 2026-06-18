'use client'

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
] as const

interface Props {
  value: number
  onChange: (hours: number) => void
}

export function RangeSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1">
      {RANGES.map(r => {
        const active = r.hours === value
        return (
          <button
            key={r.hours}
            onClick={() => onChange(r.hours)}
            className={`text-[11px] font-mono rounded-full px-2.5 py-1 transition-colors ${
              active
                ? 'bg-accent text-accent-fg'
                : 'text-subtle hover:text-fg'
            }`}
            style={active ? undefined : { background: 'var(--card-2)', border: '1px solid var(--border)' }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}
