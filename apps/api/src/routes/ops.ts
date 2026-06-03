import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { runTerraform, runAnsible } from '@emit-infra/core'
import { discoverProjects } from '../lib/discover-projects.js'
import { executeTool } from '../lib/tool-executor.js'
import { getAgentSessionId, setAgentSessionId, clearHistory } from '../lib/claude-session.js'
import { writeEvent } from '../lib/write-sse.js'

const SYSTEM =
  'You are an infrastructure operations assistant for emit-infra. Use the provided tools to answer questions and take actions. For deploy, provision, and destroy, always call the tool — never describe the action without calling it. Inform the user a confirmation card will appear. Be concise.'

interface ChatBody {
  sessionId: string
  message: string
  confirmationFor?: string
}

type PendingConf = { toolName: string; projectName: string }
type ToolResult = { toolName: string; target: string; result: unknown }

export async function opsRoutes(app: FastifyInstance) {
  app.get('/ops/session', async () => ({ sessionId: randomUUID() }))

  app.delete<{ Params: { id: string } }>('/ops/session/:id', async (req, reply) => {
    clearHistory(req.params.id)
    return reply.send({ ok: true })
  })

  app.post<{ Body: ChatBody }>('/ops/chat', async (req, reply) => {
    const { sessionId, message, confirmationFor } = req.body

    // SSE execution path — runs Ansible/Terraform after user confirms
    if (confirmationFor) {
      const [toolName, ...parts] = confirmationFor.split(':')
      const projectName = parts.join(':')
      const project = discoverProjects().find((p) => p.config.name === projectName) ?? null
      const projectDir = join(homedir(), 'projects', projectName)

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      let exitCode = 0
      if (!project) {
        writeEvent(reply.raw, { type: 'error', message: `Project '${projectName}' not found` })
        writeEvent(reply.raw, { type: 'done', exitCode: 1 })
        reply.raw.end()
        return
      }

      try {
        if (toolName === 'deploy') {
          await runAnsible('deploy', join(projectDir, 'inventory.ini'), { project_name: projectName }, (s, t) =>
            writeEvent(reply.raw, { type: 'line', stream: s, text: t }),
          )
        } else if (toolName === 'provision') {
          await runTerraform('apply', ['-auto-approve'], join(projectDir, 'terraform'), (s, t) =>
            writeEvent(reply.raw, { type: 'line', stream: s, text: t }),
          )
        } else if (toolName === 'destroy') {
          await runTerraform('destroy', ['-auto-approve'], join(projectDir, 'terraform'), (s, t) =>
            writeEvent(reply.raw, { type: 'line', stream: s, text: t }),
          )
        }
      } catch {
        exitCode = 1
      }

      writeEvent(reply.raw, { type: 'done', exitCode })
      reply.raw.end()
      return
    }

    // Chat path — Agent SDK with in-process MCP tools
    let pendingConfirmation: PendingConf | undefined
    const toolResults: ToolResult[] = []

    const listProjects = tool('list_projects', 'List all managed infrastructure projects.', {}, async () => {
      const result = await executeTool('list_projects', {})
      toolResults.push({ toolName: 'list_projects', target: 'all', result })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    })

    const getStatus = tool(
      'get_status',
      'Get server status (uptime, disk %, memory %) for a project.',
      { name: z.string().describe('Project name') },
      async ({ name }) => {
        const result = await executeTool('get_status', { name })
        toolResults.push({ toolName: 'get_status', target: name, result })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      },
    )

    const getContainers = tool(
      'get_containers',
      'List running Docker containers for a project.',
      { name: z.string().describe('Project name') },
      async ({ name }) => {
        const result = await executeTool('get_containers', { name })
        toolResults.push({ toolName: 'get_containers', target: name, result })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      },
    )

    const getLogs = tool(
      'get_logs',
      'Collect Docker Compose logs for a project.',
      {
        name: z.string().describe('Project name'),
        service: z.string().optional().describe('Optional service name filter'),
      },
      async ({ name, service }) => {
        const result = await executeTool('get_logs', { name, service })
        toolResults.push({ toolName: 'get_logs', target: name, result })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      },
    )

    const deploy = tool(
      'deploy',
      'Deploy a project via Ansible. Requires user confirmation.',
      { name: z.string().describe('Project name') },
      async ({ name }) => {
        pendingConfirmation = { toolName: 'deploy', projectName: name }
        return { content: [{ type: 'text' as const, text: `Confirmation required to deploy "${name}". Tell the user a confirmation card will appear in the UI.` }] }
      },
    )

    const provision = tool(
      'provision',
      'Provision infrastructure with Terraform. Requires user confirmation.',
      { name: z.string().describe('Project name') },
      async ({ name }) => {
        pendingConfirmation = { toolName: 'provision', projectName: name }
        return { content: [{ type: 'text' as const, text: `Confirmation required to provision "${name}". Tell the user a confirmation card will appear in the UI.` }] }
      },
    )

    const destroy = tool(
      'destroy',
      'Destroy all infrastructure for a project. IRREVERSIBLE. Requires user confirmation.',
      { name: z.string().describe('Project name') },
      async ({ name }) => {
        pendingConfirmation = { toolName: 'destroy', projectName: name }
        return { content: [{ type: 'text' as const, text: `Confirmation required to destroy "${name}". Tell the user a confirmation card will appear in the UI. This action is IRREVERSIBLE.` }] }
      },
    )

    const server = createSdkMcpServer({
      name: 'emit-infra',
      tools: [listProjects, getStatus, getContainers, getLogs, deploy, provision, destroy],
    })

    const agentSessionId = getAgentSessionId(sessionId)
    const textParts: string[] = []
    let capturedAgentSessionId: string | undefined

    try {
      for await (const msg of query({
        prompt: message,
        options: {
          systemPrompt: SYSTEM,
          ...(agentSessionId ? { resume: agentSessionId } : {}),
          mcpServers: { emitInfra: server },
          maxTurns: 10,
        },
      })) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          capturedAgentSessionId = (msg as Record<string, unknown>)['session_id'] as string | undefined
        }
        if ('result' in msg && typeof msg.result === 'string') {
          textParts.push(msg.result)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(503).send({ error: `Agent unavailable: ${message}` })
    }

    if (capturedAgentSessionId) setAgentSessionId(sessionId, capturedAgentSessionId)

    return reply.send({
      reply: textParts.join(''),
      pendingConfirmation,
      toolResults,
    })
  })
}
