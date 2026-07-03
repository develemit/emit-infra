export interface ProjectDigestData {
  project: string
  incidents: { falsePositive?: boolean }[]
  deploys: unknown[]
  diskPctNow: number | undefined
  diskPctWeekAgo: number | undefined
}

export interface DiskDelta {
  project: string
  deltaPct: number
}

export interface WeeklyDigest {
  incidentCount: number
  deployCount: number
  diskDeltas: DiskDelta[]
  summaryLine: string
}

export function buildDigest(projects: ProjectDigestData[]): WeeklyDigest {
  const incidentCount = projects.reduce(
    (sum, p) => sum + p.incidents.filter(i => !i.falsePositive).length,
    0,
  )
  const deployCount = projects.reduce((sum, p) => sum + p.deploys.length, 0)

  const diskDeltas: DiskDelta[] = projects
    .filter(p => p.diskPctNow !== undefined && p.diskPctWeekAgo !== undefined)
    .map(p => ({ project: p.project, deltaPct: Math.round(p.diskPctNow! - p.diskPctWeekAgo!) }))
    .filter(d => d.deltaPct !== 0)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))

  const parts: string[] = [
    `${incidentCount} ${incidentCount === 1 ? 'incident' : 'incidents'}`,
    `${deployCount} ${deployCount === 1 ? 'deploy' : 'deploys'}`,
  ]

  const top = diskDeltas[0]
  if (top) {
    const sign = top.deltaPct > 0 ? '+' : ''
    parts.push(`disk ${sign}${top.deltaPct}% on ${top.project}`)
  }

  return {
    incidentCount,
    deployCount,
    diskDeltas,
    summaryLine: `This week: ${parts.join(', ')}`,
  }
}
