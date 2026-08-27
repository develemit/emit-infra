import type { ProjectConfig } from '@emit-infra/core'

/**
 * Maps `blueGreen.services[].name` to the extra-var the nginx role's initial
 * blue-slot template reads (`ansible/roles/nginx/tasks/main.yml:143-150`).
 * A service name with no entry here falls back to the role's own default
 * port — see `ansible/README.md`'s blue-slot table.
 */
const SLOT_PORT_VARS: Record<string, string> = {
  web: 'blue_web_port',
  api: 'blue_api_port',
  worker: 'blue_worker_port',
  marketing: 'blue_marketing_port',
}

/**
 * Builds the extra-vars `provision.yml` needs to gate the nginx role's
 * blue-green tasks — `blue_green` plus the blue-slot ports it seeds into
 * `/etc/nginx/blue-green/<project>.conf` before the first deploy. Shared by
 * `configure` and `setup` so their provisioning calls can't drift apart
 * (sprint 316). Returns `{}` for non-blue-green projects, so callers can
 * spread the result in unconditionally.
 */
export function buildBlueGreenProvisionVars(config: ProjectConfig): Record<string, unknown> {
  if (!config.blueGreen) return {}

  const vars: Record<string, unknown> = { blue_green: true }
  for (const service of config.blueGreen.services) {
    const key = SLOT_PORT_VARS[service.name]
    if (key) vars[key] = service.bluePort
  }
  return vars
}
