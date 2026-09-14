/**
 * Enumerate and parse TLS certificates on a fleet server.
 *
 * Certificates are read from every /etc/letsencrypt/live/* entry rather than
 * a single path derived from the project's `domain` — a server can hold
 * certificates for names that don't match its configured domain (e.g.
 * emit-vision's domain is emitvision.com but its only certificate is
 * api.emitvision.com), and the domain-keyed lookup silently produced no
 * value for those.
 */

export interface CertInfo {
  name: string
  notAfter: string
  daysRemaining: number
}

const CERT_START = '---CERTS---'
const CERT_END = '---ENDCERTS---'
const CERTBOT_START = '---CERTBOT---'
const CERTBOT_END = '---ENDCERTBOT---'

/** Shell fragment meant to be spliced into the existing single SSH command per
 *  project — no extra round trip per poll. Emits one CERT|<name>|<notAfter>
 *  line per certificate between marker lines the caller can locate by string,
 *  followed by certbot's last renewal outcome between a second marker pair. */
export const CERT_PROBE_CMD =
  `echo '${CERT_START}'; ` +
  `for f in /etc/letsencrypt/live/*/fullchain.pem; do ` +
  `[ -e "$f" ] || continue; ` +
  `n=$(basename "$(dirname "$f")"); ` +
  `[ "$n" = "README" ] && continue; ` +
  `e=$(openssl x509 -enddate -noout -in "$f" 2>/dev/null | sed 's/notAfter=//'); ` +
  `echo "CERT|$n|$e"; ` +
  `done; ` +
  `echo '${CERT_END}'; ` +
  `echo '${CERTBOT_START}'; ` +
  `printf 'RESULT=%s\\n' "$(systemctl show certbot.service -p Result --value 2>/dev/null)"; ` +
  `printf 'LASTRAN=%s\\n' "$(systemctl show certbot.service -p ExecMainExitTimestamp --value 2>/dev/null)"; ` +
  `printf 'RENEWERR=%s\\n' "$(journalctl -u certbot -n 50 --no-pager 2>/dev/null | grep -i 'error' | tail -1)"; ` +
  `echo '${CERTBOT_END}'`

/** Pulls the CERT|... lines out of a full SSH response (already split into
 *  trimmed lines) using the markers CERT_PROBE_CMD wrote. */
export function extractCertSection(lines: string[]): string[] {
  const start = lines.indexOf(CERT_START)
  const end = lines.indexOf(CERT_END)
  if (start === -1 || end === -1 || end < start) return []
  return lines.slice(start + 1, end)
}

/** Pulls the RESULT=/LASTRAN=/RENEWERR= lines out of a full SSH response
 *  (already split into trimmed lines) using the markers CERT_PROBE_CMD wrote. */
export function extractCertbotSection(lines: string[]): string[] {
  const start = lines.indexOf(CERTBOT_START)
  const end = lines.indexOf(CERTBOT_END)
  if (start === -1 || end === -1 || end < start) return []
  return lines.slice(start + 1, end)
}

/** Index of the line right after the whole probe block (certs + certbot) —
 *  where the rest of the probe command's output (backup age, etc.) continues.
 *  -1 if markers absent. */
export function probeBlockEndIndex(lines: string[]): number {
  return lines.indexOf(CERTBOT_END)
}

export function parseCertLines(certLines: string[], nowMs = Date.now()): CertInfo[] {
  const certs: CertInfo[] = []
  for (const line of certLines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('CERT|')) continue
    const parts = trimmed.split('|')
    const name = parts[1]
    const notAfter = parts.slice(2).join('|')
    if (!name || name === 'README' || !notAfter) continue
    const expiry = new Date(notAfter)
    if (isNaN(expiry.getTime())) continue
    certs.push({ name, notAfter, daysRemaining: Math.floor((expiry.getTime() - nowMs) / 86400000) })
  }
  return certs
}

export function soonestExpiring(certs: CertInfo[]): CertInfo | undefined {
  return certs.reduce<CertInfo | undefined>(
    (soonest, cert) => (!soonest || cert.daysRemaining < soonest.daysRemaining ? cert : soonest),
    undefined,
  )
}

export interface CertbotStatus {
  /** systemd's Result for the last certbot.service run, e.g. 'success' or
   *  'exit-code'. Empty string when unreadable. */
  result: string
  /** When that run finished, in ms epoch — null when certbot.service has
   *  never run (or doesn't exist; systemd still reports Result='success' for
   *  a not-found unit, so this is the field that actually distinguishes
   *  "no timer" from "ran and succeeded"). */
  lastRanAt: number | null
  /** Most recent 'error' line from the certbot journal, or null when none
   *  matched. */
  errorLine: string | null
}

export function parseCertbotSection(section: string[]): CertbotStatus {
  const find = (prefix: string): string => {
    const line = section.find(l => l.startsWith(prefix))
    return line === undefined ? '' : line.slice(prefix.length).trim()
  }

  const result = find('RESULT=')

  const lastRanRaw = find('LASTRAN=')
  const lastRanMs = lastRanRaw ? new Date(lastRanRaw).getTime() : NaN
  const lastRanAt = isNaN(lastRanMs) ? null : lastRanMs

  const errorLine = find('RENEWERR=') || null

  return { result, lastRanAt, errorLine }
}

export type RenewalHealth = 'failing' | 'stale-failure' | 'ok' | 'unknown'

/**
 * Classifies certbot's renewal health from its last run plus the soonest
 * certificate expiry (sprint 332's enumeration). `Result` alone is a stale
 * signal — it's the last run's outcome and doesn't clear until the next run,
 * so a fixed-by-hand certificate can still read 'exit-code' for hours. Only
 * treat a failed run as actionable ('failing') when the soonest certificate
 * is inside certbot's 30-day renewal window; outside that window the failure
 * is stale and shouldn't page anyone ('stale-failure').
 */
export function classifyRenewalHealth(status: CertbotStatus, certs: CertInfo[]): RenewalHealth {
  if (status.lastRanAt === null || !status.result) return 'unknown'
  if (status.result === 'success') return 'ok'

  const soonest = soonestExpiring(certs)
  if (!soonest) return 'unknown'
  return soonest.daysRemaining <= 30 ? 'failing' : 'stale-failure'
}
