'use client'
import { useState, useEffect, useCallback } from 'react'
import { getApiBase } from '@/lib/api-auth'
import { getStatus, getProjects } from '@/lib/api-projects'
import { getDeployHistory, getCiHistory } from '@/lib/api-history'
import type { ChatMessage, ChatResponse, ConfirmType } from '@/components/ops/types'
import { genId, getConfirmText, buildContextString } from '@/lib/ops-chat-context'
import { useOpsSession } from '@/lib/use-ops-session'

export function useOpsChat(initialContextProject: string | null) {
  const apiBase = getApiBase()
  const { sessionId, resetting, resetSession } = useOpsSession()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [contextProject, setContextProject] = useState<string | null>(initialContextProject)
  const [statusContext, setStatusContext] = useState<string | null>(null)
  const [contextBuildLabel, setContextBuildLabel] = useState<string>('')

  useEffect(() => {
    if (!contextProject) return
    void Promise.all([
      getStatus(contextProject),
      getProjects(),
      getDeployHistory(contextProject, 3).catch(() => ({ deploys: [] })),
      getCiHistory(contextProject, 10).catch(() => ({ runs: [] })),
    ]).then(([status, projects, deployRes, ciRes]) => {
      const project = projects.find(p => p.config.name === contextProject)
      const domain = project?.config.domain ?? contextProject
      const context = buildContextString(
        contextProject,
        domain,
        status,
        deployRes.deploys,
        ciRes.runs,
      )
      setStatusContext(context)
      setContextBuildLabel(status.buildNumber ? `Build #${status.buildNumber}` : 'unknown build')
    }).catch(err => {
      console.error('Failed to fetch context:', err)
    })
  }, [contextProject])

  const push = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev, msg])
  }, [])

  const submit = useCallback(async (text: string) => {
    if (!sessionId || !text.trim() || loading) return
    setLoading(true)
    push({ id: genId(), type: 'user', text })

    const isFirstMessage = messages.length === 0
    const body: Record<string, unknown> = { sessionId, message: text }
    if (isFirstMessage && statusContext) body['systemContext'] = statusContext

    try {
      const res = await fetch(`${apiBase}/ops/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as ChatResponse

      if (data.toolResults) {
        for (const tr of data.toolResults) {
          push({ id: genId(), type: 'tool', toolName: tr.toolName, target: tr.target ?? 'all', result: tr.result })
        }
      }
      if (data.pendingConfirmation) {
        const { toolName, projectName: pName } = data.pendingConfirmation
        const { subtitle, description } = getConfirmText(toolName, pName)
        push({
          id: genId(),
          type: 'confirm',
          confirmationType: toolName as ConfirmType,
          projectName: pName,
          subtitle,
          description,
          sseUrl: `${apiBase}/ops/chat`,
          sseBody: JSON.stringify({
            sessionId,
            message: `Confirmed ${toolName} for ${pName}.`,
            confirmationFor: `${toolName}:${pName}`,
          }),
        })
      }
      if (data.reply) {
        push({ id: genId(), type: 'claude', text: data.reply })
      }
    } catch (err) {
      push({ id: genId(), type: 'claude', text: `Error: ${String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [sessionId, apiBase, loading, push, messages.length, statusContext])

  function handleCancel() {
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.type === 'confirm')
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      return prev.filter((_, i) => i !== realIdx)
    })
    void submit('Cancel that.')
  }

  async function handleNewConversation() {
    await resetSession(() => setMessages([]))
  }

  function clearContext() {
    setContextProject(null)
    setStatusContext(null)
  }

  return {
    messages,
    loading,
    resetting,
    contextProject,
    statusContext,
    contextBuildLabel,
    submit,
    handleCancel,
    handleNewConversation,
    clearContext,
  }
}
