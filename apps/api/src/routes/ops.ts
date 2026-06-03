import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { runTerraform, runAnsible } from '@emit-infra/core'
import { tools } from '../lib/claude-tools.js'
import { getHistory, appendMessage } from '../lib/claude-session.js'
import { executeTool, type PendingConfirmation } from '../lib/tool-executor.js'
import { discoverProjects } from '../lib/discover-projects.js'
import { writeEvent } from '../lib/write-sse.js'

const SYSTEM =
  'You are an infrastructure operations assistant for emit-infra. Use the provided tools to answer questions and take actions. For deploy, provision, and destroy, always use the tool — never describe the action without calling it. Be concise.'

interface ChatBody {
  sessionId: string
  message: string
  confirmationFor?: string
}

export async function opsRoutes(app: FastifyInstance) {
  const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

  app.get('/ops/session', async () => ({ sessionId: randomUUID() }))

  app.post<{ Body: ChatBody }>('/ops/chat', async (req, reply) => {
    const { sessionId, message, confirmationFor } = req.body

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
      appendMessage(sessionId, { role: 'user', content: `Confirmed ${toolName} for ${projectName}.` })
      appendMessage(sessionId, {
        role: 'assistant',
        content: `${toolName} for ${projectName} completed (exit ${exitCode}).`,
      })
      return
    }

    // Normal chat path
    appendMessage(sessionId, { role: 'user', content: message })
    const messages = getHistory(sessionId)

    const first = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      tools,
      messages,
    })

    if (first.stop_reason !== 'tool_use') {
      const text = first.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      appendMessage(sessionId, { role: 'assistant', content: first.content })
      return reply.send({ reply: text })
    }

    // Tool use path
    appendMessage(sessionId, { role: 'assistant', content: first.content })
    let pendingConfirmation: PendingConfirmation | undefined
    const toolResultContent: Anthropic.ToolResultBlockParam[] = []
    const toolResults: Array<{ toolName: string; result: unknown }> = []

    for (const block of first.content) {
      if (block.type !== 'tool_use') continue
      const result = await executeTool(block.name, block.input as Record<string, unknown>)
      if (result && typeof result === 'object' && 'requiresConfirmation' in result) {
        pendingConfirmation = result as PendingConfirmation
        break
      }
      toolResults.push({ toolName: block.name, result })
      toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
    }

    if (pendingConfirmation) {
      return reply.send({ reply: '', pendingConfirmation })
    }

    // Follow-up with tool results
    appendMessage(sessionId, { role: 'user', content: toolResultContent })
    const second = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      tools,
      messages: getHistory(sessionId),
    })
    const text = second.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    appendMessage(sessionId, { role: 'assistant', content: second.content })
    return reply.send({ reply: text, toolResults })
  })
}
