import { phaseSegments, formatPhaseSummary } from '@/lib/deploy-phases'

interface Props {
  phases: Record<string, number> | undefined
}

export function DeployPhaseBar({ phases }: Props) {
  const segments = phaseSegments(phases)
  if (segments.length === 0) return null

  return (
    <div className="mt-1.5">
      <div className="flex" style={{ height: 6, gap: 2 }} title={formatPhaseSummary(segments)}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            style={{
              width: `${s.pct}%`,
              background: `var(--phase-${s.key})`,
              borderRadius: `${i === 0 ? 3 : 0}px ${i === segments.length - 1 ? 3 : 0}px ${i === segments.length - 1 ? 3 : 0}px ${i === 0 ? 3 : 0}px`,
            }}
          />
        ))}
      </div>
      <div className="mt-1 text-[10.5px] font-mono text-subtle truncate max-w-[420px]">
        {formatPhaseSummary(segments)}
      </div>
    </div>
  )
}
