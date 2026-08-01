export interface PhaseSegment {
  key: string
  label: string
  seconds: number
  pct: number
}

const PHASE_ORDER = ['ci', 'auth', 'build', 'retag', 'preDeploy', 'deploy'] as const

const PHASE_LABELS: Record<(typeof PHASE_ORDER)[number], string> = {
  ci: 'ci',
  auth: 'auth',
  build: 'build',
  retag: 'retag',
  preDeploy: 'pre-deploy',
  deploy: 'deploy',
}

export function phaseSegments(phases: Record<string, number> | undefined): PhaseSegment[] {
  if (!phases) return []
  const total = PHASE_ORDER.reduce((sum, key) => sum + (phases[key] ?? 0), 0)
  if (total === 0) return []

  return PHASE_ORDER
    .filter(key => (phases[key] ?? 0) > 0)
    .map(key => ({
      key,
      label: PHASE_LABELS[key],
      seconds: phases[key]!,
      pct: (phases[key]! / total) * 100,
    }))
}

export function formatPhaseSummary(segments: PhaseSegment[]): string {
  return segments.map(s => `${s.label} ${s.seconds}s`).join(' · ')
}
