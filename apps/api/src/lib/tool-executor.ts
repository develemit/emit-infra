import { homedir } from 'node:os'
import { join } from 'node:path'
import { sshExec, sshMuxArgs } from '@emit-infra/core'
import { SAFE_CONTAINER_RE } from './project-helpers.js'
import { discoverProjects } from './discover-projects.js'
import { streamProcess } from './stream-process.js'

export interface PendingConfirmation {
  requiresConfirmation: true
  toolName: 'deploy' | 'provision' | 'destroy'
  projectName: string
}

const DESTRUCTIVE = new Set(['deploy', 'provision', 'destroy'])

function sshKeyPath(keyName = 'emit-deploy'): string {
  return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
}

async function findProject(name: string) {
  return (await discoverProjects()).find((p) => p.config.name === name) ?? null
}

async function collectLogs(host: string, service: string, keyName?: string): Promise<string> {
  const key = sshKeyPath(keyName)
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
      return (await discoverProjects()).map((p) => ({
        name: p.config.name,
        domain: p.config.domain,
        region: p.config.region,
      }))

    case 'get_status': {
      const project = await findProject(input['name'] as string)
      if (!project) return { error: 'project not found' }
      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      try {
        const raw = await sshExec(
          host,
          "uptime -p; df -h / | tail -1 | awk '{print $5}'; free -m | awk 'NR==2{printf \"%.0f\\n\", $3/$2*100}'",
          key,
        )
        const [uptime, disk, mem] = raw.split('\n').map(l => l.trim())
        return { uptime: uptime ?? '', disk: disk ?? '', memory: `${mem ?? '0'}%` }
      } catch {
        return { error: 'unreachable' }
      }
    }

    case 'get_containers': {
      const project = await findProject(input['name'] as string)
      if (!project) return { error: 'project not found' }
      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      const fmt = '{"name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}"}'
      try {
        const out = await sshExec(host, `docker ps -a --format '${fmt}'`, key)
        return out.split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => {
          try {
            return [JSON.parse(l) as unknown]
          } catch {
            console.warn(`[tool-executor] skipped malformed docker ps line: ${l.slice(0, 100)}`)
            return []
          }
        })
      } catch {
        return { error: 'unreachable' }
      }
    }

    case 'get_logs': {
      const project = await findProject(input['name'] as string)
      if (!project) return { error: 'project not found' }
      const service = (input['service'] as string) ?? ''
      if (service && !SAFE_CONTAINER_RE.test(service)) {
        return { error: 'invalid service name' }
      }
      const host = project.config.serverIp ?? project.config.domain
      const logs = await collectLogs(host, service, project.config.sshKeyName)
      return { logs: logs.slice(-4000) }
    }

    default:
      return { error: `unknown tool: ${toolName}` }
  }
}
