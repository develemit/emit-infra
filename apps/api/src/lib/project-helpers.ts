import { homedir } from 'node:os'
import { join } from 'node:path'
import { discoverProjects } from './discover-projects.js'

export const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
// Docker container/service names — excludes quotes and shell metacharacters,
// which is what makes single-quoted interpolation into remote commands safe.
export const SAFE_CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
export const SAFE_DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i

export function sshKeyPath(keyName = 'emit-deploy'): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
}

export async function findProject(name: string) {
  return (await discoverProjects()).find((p) => p.config.name === name) ?? null
}
