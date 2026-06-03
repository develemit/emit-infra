import { homedir } from 'node:os'
import { join } from 'node:path'
import { sshExec, sshMuxArgs } from '@emit-infra/core'
import { discoverProjects } from './discover-projects.js'
import { streamProcess } from './stream-process.js'

export interface PendingConfirmation {
  requiresConfirmation: true
  toolName: 'deploy' | 'provision' | 'destroy'
  projectName: string
}

const DESTRUCTIVE = new Set(['deploy', 'provision', 'destroy'])

function sshKeyPath(): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', 'emit-deploy')
}

function findProject(name: string) {
  return discoverProjects().find((p) => p.config.name === name) ?? null
}

async function collectLogs(host: string, service: string): Promise<string> {
  const key = sshKeyPath()
  const cmd = service ? `docker compose logs --tail=200 ${service}` : 'docker compose logs --tail=200'
  const args = [
    '-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
    ...sshMuxArgs(),
    `root@${host}`, cmd,
  ]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const lines: string[] = []
  try {
    for await (const ev of streamProcess('ssh', args, { signal: controller.signal })) {
      if (ev.type === 'line') lines.push(ev.text)
      if (ev.type === 'done' || ev.type === 'error') break
    }
  } finally {
    clearTimeout(timer)
  }
  return lines.slice(-200).join('\n')
}

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (DESTRUCTIVE.has(toolName)) {
    return {
      requiresConfirmation: true,
      toolName: toolName as PendingConfirmation['toolName'],
      projectName: input['name'] as string,
    } satisfies PendingConfirmation
  }

  switch (toolName) {
    case 'list_projects':
      return discoverProjects().map((p) => ({
        name: p.config.name,
        domain: p.config.domain,
        region: p.config.region,
      }))

    case 'get_status': {
      const project = findProject(input['name'] as string)
      if (!project) return { error: 'project not found' }
      const key = sshKeyPath()
      const host = project.config.domain
      try {
        const [uptime, disk, mem] = await Promise.all([
          sshExec(host, 'uptime -p', key),
          sshExec(host, "df -h / | tail -1 | awk '{print $5}'", key),
          sshExec(host, "free -m | awk 'NR==2{printf \"%.0f\", $3/$2*100}'", key),
        ])
        return { uptime: uptime.trim(), disk: disk.trim(), memory: `${mem.trim()}%` }
      } catch {
        return { error: 'unreachable' }
      }
    }

    case 'get_containers': {
      const project = findProject(input['name'] as string)
      if (!project) return { error: 'project not found' }
      const key = sshKeyPath()
      const fmt = '{"name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}"}'
      try {
        const out = await sshExec(project.config.domain, `docker ps --format '${fmt}'`, key)
        return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
      } catch {
        return { error: 'unreachable' }
      }
    }

    case 'get_logs': {
      const project = findProject(input['name'] as string)
      if (!project) return { error: 'project not found' }
      const logs = await collectLogs(project.config.domain, (input['service'] as string) ?? '')
      return { logs: logs.slice(-4000) }
    }

    default:
      return { error: `unknown tool: ${toolName}` }
  }
}
