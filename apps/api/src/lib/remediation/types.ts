export type Urgency = 'now' | 'soon' | 'watch' | 'none'

export interface Step {
  text: string
  command?: string
  link?: string
}

export interface Remediation {
  urgency: Urgency
  headline: string
  steps: Step[]
}

interface Base {
  project: string
  serverIp?: string | undefined
}

export type Finding =
  | (Base & { kind: 'disk'; pct: number; projectedDaysUntilFull?: number | null | undefined })
  | (Base & { kind: 'mem'; pct: number })
  | (Base & { kind: 'cert'; daysLeft?: number | undefined; error?: string | undefined; failing?: boolean })
  | (Base & { kind: 'backup'; ageHours?: number | undefined; status?: string | undefined })
  | (Base & { kind: 'health'; check: 'ssh' | 'http'; status?: number | undefined; recovered?: boolean; durationMs?: number })
  | (Base & { kind: 'deploy-failed'; sha?: string | undefined; error: string })
  | (Base & { kind: 'incidents'; count: number })

export type FindingOf<K extends Finding['kind']> = Extract<Finding, { kind: K }>
