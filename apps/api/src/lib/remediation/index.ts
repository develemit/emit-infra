import { remediateBackup } from './backup.js'
import { remediateCert } from './cert.js'
import { remediateDeployFailed } from './deploy.js'
import { remediateDisk } from './disk.js'
import { remediateHealth } from './health.js'
import { remediateIncidents } from './incidents.js'
import { remediateMem } from './mem.js'
import { URGENCY_RANK } from './shared.js'
import type { Finding, Remediation } from './types.js'

export type { Finding, Remediation, Step, Urgency } from './types.js'
export { EMIT_INFRA_COMMANDS } from './commands.js'

export function remediate(f: Finding): Remediation {
  switch (f.kind) {
    case 'disk': return remediateDisk(f)
    case 'mem': return remediateMem(f)
    case 'cert': return remediateCert(f)
    case 'backup': return remediateBackup(f)
    case 'health': return remediateHealth(f)
    case 'deploy-failed': return remediateDeployFailed(f)
    case 'incidents': return remediateIncidents(f)
  }
}

export const worstFirst = <T extends { urgency: Remediation['urgency'] }>(items: T[]): T[] =>
  [...items].sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency])
