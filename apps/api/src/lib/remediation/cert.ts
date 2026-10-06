import { sshCmd } from './shared.js'
import type { FindingOf, Remediation } from './types.js'

export const CERT_SOON_DAYS = 21
export const CERT_NOW_DAYS = 7

export function remediateCert(f: FindingOf<'cert'>): Remediation {
  if (f.daysLeft !== undefined && f.daysLeft >= CERT_SOON_DAYS && !f.error && !f.failing) {
    return { urgency: 'none', headline: `Certificate has ${Math.round(f.daysLeft)} days left`, steps: [] }
  }
  const urgency = f.daysLeft !== undefined && f.daysLeft < CERT_NOW_DAYS ? 'now' : 'soon'
  const left = f.daysLeft === undefined ? 'Certificate is unreadable' : `Certificate expires in ${Math.round(f.daysLeft)} days`
  return {
    urgency,
    headline: left,
    steps: [
      ...(f.error ? [{ text: `certbot reported: ${f.error}` }] : []),
      { text: 'Reproduce the renewal failure without changing anything.', command: sshCmd(f.serverIp, 'certbot renew --dry-run') },
      {
        text: 'Check the renewal method. "Could not bind port 80" means standalone mode is fighting nginx; switch to webroot (diner-decider expired this way in 2026-09).',
        command: sshCmd(f.serverIp, 'grep -r authenticator /etc/letsencrypt/renewal/'),
        link: 'docs/DEPLOYMENT-PITFALLS.md',
      },
      { text: 'Make sure scripts/ensure-cert-renewal.sh has been applied so renewal and the nginx reload hook are installed.' },
      { text: 'Once the dry run passes, renew for real.', command: sshCmd(f.serverIp, 'certbot renew && nginx -s reload') },
    ],
  }
}
