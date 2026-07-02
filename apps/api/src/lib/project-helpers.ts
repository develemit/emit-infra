import { homedir } from 'node:os'
import { join } from 'node:path'
import { discoverProjects } from './discover-projects.js'

export const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export function sshKeyPath(keyName = 'emit-deploy'): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
}

export async function findProject(name: string) {
  return (await discoverProjects()).find((p) => p.config.name === name) ?? null
}
