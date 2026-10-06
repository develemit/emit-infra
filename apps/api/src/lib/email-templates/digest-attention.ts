import { remediate, worstFirst, type Finding, type Remediation, type Urgency } from '../remediation/index.js'
import type { Tint } from './layout.js'
import type { DigestProjectRow } from './digest.js'

export interface AttentionItem extends Remediation {
  project: string
  kind: Finding['kind']
}

export const tintFor = (u: Urgency): Tint | undefined => (u === 'now' ? 'red' : u === 'none' ? undefined : 'amber')

export function findingsFor(r: DigestProjectRow): Finding[] {
  const base = { project: r.project }
  const out: Finding[] = []
  if (r.status === 'down') out.push({ ...base, kind: 'health', check: 'http' })
  if (r.diskPct !== undefined) out.push({ ...base, kind: 'disk', pct: r.diskPct })
  if (r.certDays !== undefined) out.push({ ...base, kind: 'cert', daysLeft: r.certDays })
  if (r.backupAgeHours !== undefined) out.push({ ...base, kind: 'backup', ageHours: r.backupAgeHours })
  out.push({ ...base, kind: 'incidents', count: r.incidents })
  return out
}

export function attentionItems(rows: DigestProjectRow[]): AttentionItem[] {
  const items = rows.flatMap((row) =>
    findingsFor(row).map((f): AttentionItem => ({ project: row.project, kind: f.kind, ...remediate(f) })),
  )
  return worstFirst(items.filter((i) => i.urgency !== 'none'))
}

export const worstUrgency = (items: AttentionItem[]): Urgency => items[0]?.urgency ?? 'none'
