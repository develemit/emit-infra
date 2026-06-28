'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/icon'
import { ChatThread } from '@/components/ops/chat-thread'
import { ChatInput } from '@/components/ops/chat-input'
import { useOpsChat } from '@/lib/use-ops-chat'

function OpsPageInner() {
  const searchParams = useSearchParams()
  const projectName = searchParams.get('project')

  const {
    messages, loading, resetting,
    contextProject, statusContext, contextBuildLabel,
    submit, handleCancel, handleNewConversation, clearContext,
  } = useOpsChat(projectName)

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-3 px-4 lg:px-6 border-b border-border shrink-0"
        style={{ height: 56 }}
      >
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-soft)' }}
        >
          <Icon name="zap" size={13} style={{ color: 'var(--accent-bright)' }} />
        </div>
        <span className="text-[15px] font-semibold text-fg">Claude Ops</span>
        <div className="flex-1" />
        <button
          onClick={() => void handleNewConversation()}
          disabled={resetting}
          className="text-[12px] text-subtle hover:text-fg disabled:opacity-50 transition-colors"
        >
          {resetting ? 'Resetting…' : 'New conversation'}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-[120px] lg:pb-4">
          <div className="lg:max-w-[720px] lg:mx-auto">
            {contextProject && statusContext && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-border bg-card text-[12px] text-subtle">
                <Icon name="zap" size={12} style={{ color: 'var(--accent-bright)', flexShrink: 0 }} />
                <span className="flex-1 truncate">Context: <span className="text-fg font-medium">{contextProject}</span> · {contextBuildLabel}</span>
                <button
                  onClick={clearContext}
                  className="text-subtle hover:text-fg transition-colors shrink-0"
                  title="Clear context"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            )}
            <ChatThread messages={messages} loading={loading} onCancel={handleCancel} />
          </div>
        </div>

        <div className="hidden lg:block pb-4">
          <div className="max-w-[720px] mx-auto px-4">
            <ChatInput onSubmit={text => void submit(text)} disabled={loading} />
          </div>
        </div>
      </div>

      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-2 border-t border-border bg-elev">
        <ChatInput onSubmit={text => void submit(text)} disabled={loading} />
      </div>
    </div>
  )
}

export default function OpsPage() {
  return (
    <Suspense fallback={null}>
      <OpsPageInner />
    </Suspense>
  )
}
