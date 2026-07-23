import { SAFE_DOMAIN_RE } from './project-helpers.js'

export const STATUS_FIELDS = [
  'uptime',
  'disk',
  'mem',
  'containersRunning',
  'containersTotal',
  'containersUnhealthy',
  'buildNumber',
  'nginxStatus',
  'nginxConfigured',
  'sslExpiry',
  'redis',
  'queue',
  'deployedAt',
  'activeSlot',
] as const

export type StatusField = (typeof STATUS_FIELDS)[number]

/**
 * The remote output is parsed positionally, so a field that emits anything
 * other than exactly one line silently shifts every field after it. Two real
 * cases bit us: `cat` on a marker file written without a trailing newline
 * fused two fields onto one line (`buildNumber: "960active"`), and
 * `openssl … | sed …` emitted *zero* lines when the cert was missing, because
 * sed still exits 0 so the `|| echo ""` fallback never fired.
 *
 * Command substitution strips trailing newlines and printf adds exactly one;
 * head caps anything multi-line. printf rather than echo so backslashes in the
 * output are never interpreted as escapes.
 */
export function oneLine(command: string): string {
  return `printf '%s\\n' "$(${command})" | head -1`
}

function redisCli(name: string, args: string): string {
  return `cd /opt/${name} && docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qi redis && docker compose exec -T redis timeout 5 redis-cli ${args} 2>/dev/null`
}

const QUEUE_DEPTH_LUA =
  'local f=0;local w=0;for _,k in ipairs(redis.call("KEYS","bull:*:failed")) do f=f+redis.call("LLEN",k) end;for _,k in ipairs(redis.call("KEYS","bull:*:wait")) do w=w+redis.call("LLEN",k) end;return tostring(f)..":"..tostring(w)'

export function buildStatusCommand(name: string, domain: string): string {
  // Domain is interpolated into a remote path — only probe the cert when it
  // looks like a real hostname (bare-IP projects have no letsencrypt cert).
  const sslProbe = SAFE_DOMAIN_RE.test(domain)
    ? `openssl x509 -enddate -noout -in /etc/letsencrypt/live/${domain}/fullchain.pem 2>/dev/null | sed 's/notAfter=//'`
    : 'echo ""'

  const commands: Record<StatusField, string> = {
    uptime: 'uptime -p',
    disk: `df -h / | tail -1 | awk '{print $5, $3, $2}'`,
    mem: `free -m | awk 'NR==2{printf "%.0f %dM %dM\\n", $3/$2*100, $3, $2}'`,
    containersRunning: 'docker ps -q --filter status=running | wc -l',
    containersTotal: 'docker ps -aq | wc -l',
    containersUnhealthy: 'docker ps -q --filter status=restarting --filter status=dead | wc -l',
    buildNumber: `cat /opt/${name}/.deployed-version 2>/dev/null`,
    nginxStatus: 'systemctl is-active nginx 2>/dev/null || echo "unknown"',
    nginxConfigured: `test -f /etc/nginx/sites-enabled/${name} && echo "configured" || echo "missing"`,
    sslExpiry: sslProbe,
    redis: redisCli(name, 'ping'),
    queue: redisCli(name, `eval '${QUEUE_DEPTH_LUA}' 0`),
    deployedAt: `cat /opt/${name}/.deployed-at 2>/dev/null`,
    activeSlot: `cat /opt/${name}/.active-slot 2>/dev/null`,
  }

  return STATUS_FIELDS.map(field => oneLine(commands[field])).join('; ')
}

export function parseStatusLines(raw: string): Record<StatusField, string> {
  const lines = raw.split('\n').map(line => line.trim())
  const parsed = {} as Record<StatusField, string>
  STATUS_FIELDS.forEach((field, index) => {
    parsed[field] = lines[index] ?? ''
  })
  return parsed
}
