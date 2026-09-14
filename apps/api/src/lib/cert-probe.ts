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

/** Shell fragment meant to be spliced into the existing single SSH command per
 *  project — no extra round trip per poll. Emits one CERT|<name>|<notAfter>
 *  line per certificate between marker lines the caller can locate by string. */
export const CERT_PROBE_CMD =
  `echo '${CERT_START}'; ` +
  `for f in /etc/letsencrypt/live/*/fullchain.pem; do ` +
  `[ -e "$f" ] || continue; ` +
  `n=$(basename "$(dirname "$f")"); ` +
  `[ "$n" = "README" ] && continue; ` +
  `e=$(openssl x509 -enddate -noout -in "$f" 2>/dev/null | sed 's/notAfter=//'); ` +
  `echo "CERT|$n|$e"; ` +
  `done; ` +
  `echo '${CERT_END}'`

/** Pulls the CERT|... lines out of a full SSH response (already split into
 *  trimmed lines) using the markers CERT_PROBE_CMD wrote. */
export function extractCertSection(lines: string[]): string[] {
  const start = lines.indexOf(CERT_START)
  const end = lines.indexOf(CERT_END)
  if (start === -1 || end === -1 || end < start) return []
  return lines.slice(start + 1, end)
}

/** Index of the line right after the cert section — where the rest of the
 *  probe command's output (backup age, etc.) continues. -1 if markers absent. */
export function certSectionEndIndex(lines: string[]): number {
  return lines.indexOf(CERT_END)
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
