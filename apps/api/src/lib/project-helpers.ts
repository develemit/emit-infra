import { homedir } from 'node:os'
import { join } from 'node:path'
import { discoverProjects } from './discover-projects.js'

export function sshKeyPath(keyName = 'emit-deploy'): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
}

export async function findProject(name: string) {
  return (await discoverProjects()).find((p) => p.config.name === name) ?? null
}
