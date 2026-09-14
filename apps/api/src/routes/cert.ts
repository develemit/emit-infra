import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const CERT_TTL = 3_600_000

interface CertDetails {
  issuer: string
  subject: string
  serial: string
  notBefore: string
  notAfter: string
  sans: string[]
  renewTimerLastRan: string | null
  daysUntilExpiry: number
  renewalResult: string | null
  renewalError: string | null
}

const certCache = createTtlCache<CertDetails | null>(CERT_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

function parseOpenSslOutput(raw: string): CertDetails | null {
  const lines = raw.split('\n')

  const issuerLine = lines.find(l => l.startsWith('issuer=')) ?? ''
  const subjectLine = lines.find(l => l.startsWith('subject=')) ?? ''
  const serialLine = lines.find(l => l.startsWith('serial=')) ?? ''
  const notBeforeLine = lines.find(l => l.startsWith('notBefore=')) ?? ''
  const notAfterLine = lines.find(l => l.startsWith('notAfter=')) ?? ''

  const issuer = issuerLine.replace(/^issuer=/, '').trim()
  const subject = subjectLine.replace(/^subject=/, '').trim()
  const serial = serialLine.replace(/^serial=/, '').trim()
  const notBeforeStr = notBeforeLine.replace(/^notBefore=/, '').trim()
  const notAfterStr = notAfterLine.replace(/^notAfter=/, '').trim()

  if (!serial && !issuer) return null

  // SANs: look for line after "X509v3 Subject Alternative Name:" containing DNS: entries
  const sanLine = lines.find(l => l.includes('DNS:')) ?? ''
  const sans = [...sanLine.matchAll(/DNS:([^,\s]+)/g)].map(m => m[1] ?? '')

  // notAfter → daysUntilExpiry
  const notAfterDate = new Date(notAfterStr)
  const daysUntilExpiry = isNaN(notAfterDate.getTime())
    ? 0
    : Math.round((notAfterDate.getTime() - Date.now()) / 86_400_000)

  // LastTriggerUSec from systemctl show output. Despite the name, systemctl
  // formats this as a human-readable timestamp ("Mon 2026-09-14 17:36:20
  // UTC"), not a raw microsecond epoch value — verified live against a real
  // server 2026-09-14; the previous parseInt(...)/1000 logic always produced
  // NaN on real output and silently returned null.
  const timerLine = lines.find(l => l.startsWith('LastTriggerUSec=')) ?? ''
  const timerVal = timerLine.replace(/^LastTriggerUSec=/, '').trim()
  let renewTimerLastRan: string | null = null
  if (timerVal && timerVal !== '0' && timerVal !== 'timer-unavailable') {
    const d = new Date(timerVal)
    // If it resolves to 1970, treat as never
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
      renewTimerLastRan = d.toISOString()
    }
  }

  // Last certbot.service run outcome, and its most recent 'error' journal
  // line when that run failed.
  const resultLine = lines.find(l => l.startsWith('RESULT=')) ?? ''
  const renewalResult = resultLine.replace(/^RESULT=/, '').trim() || null

  const errLine = lines.find(l => l.startsWith('RENEWERR=')) ?? ''
  const renewalError = errLine.replace(/^RENEWERR=/, '').trim() || null

  return {
    issuer,
    subject,
    serial,
    notBefore: notBeforeStr ? new Date(notBeforeStr).toISOString() : '',
    notAfter: notAfterStr ? new Date(notAfterStr).toISOString() : '',
    sans,
    renewTimerLastRan,
    daysUntilExpiry,
    renewalResult,
    renewalError,
  }
}

export async function certRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>(
    '/projects/:name/cert-details',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const cached = certCache.get(name)
      if (cached !== undefined) {
        if (cached === null) return void reply.status(503).send({ error: 'unreachable' })
        return void reply.send(cached)
      }

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      const domain = project.config.domain
      const cmd =
        `openssl x509 -noout -issuer -subject -serial -startdate -enddate -ext subjectAltName` +
        ` -in /etc/letsencrypt/live/${domain}/cert.pem 2>/dev/null` +
        ` && systemctl show certbot.timer --property=LastTriggerUSec 2>/dev/null` +
        ` && printf 'RESULT=%s\\n' "$(systemctl show certbot.service -p Result --value 2>/dev/null)"` +
        ` && printf 'RENEWERR=%s\\n' "$(journalctl -u certbot -n 50 --no-pager 2>/dev/null | grep -i 'error' | tail -1)"` +
        ` || echo "timer-unavailable"`

      try {
        const raw = await sshExec(host, cmd, key)
        const result = parseOpenSslOutput(raw)
        if (!result) {
          certCache.set(name, null)
          return void reply.status(404).send({ error: 'cert not found' })
        }
        certCache.set(name, result)
        return void reply.send(result)
      } catch {
        certCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
