interface MeterProps {
  label: string
  value: number
  lg?: boolean
}

function fillColor(v: number): string {
  if (v >= 80) return 'var(--err)'
  if (v >= 65) return 'var(--warn)'
  return 'var(--accent)'
}

export function Meter({ label, value, lg }: MeterProps) {
  const pct = Math.min(100, Math.max(0, value))
  const trackH = lg ? 8 : 6

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-subtle">{label}</span>
        <span className="text-[11px] font-mono text-subtle">{pct}%</span>
      </div>
      <div
        className="w-full rounded-full overflow-hidden bg-card-2"
        style={{ height: trackH, borderRadius: 99 }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: fillColor(pct),
            borderRadius: 99,
            transition: 'width 0.4s cubic-bezier(.2,.7,.3,1)',
          }}
        />
      </div>
    </div>
  )
}
