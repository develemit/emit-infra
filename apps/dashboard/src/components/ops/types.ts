export type ConfirmType = 'deploy' | 'provision' | 'destroy'

export type ChatMessage =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'claude'; text: string }
  | { id: string; type: 'tool'; toolName: string; target: string; result: unknown }
  | {
      id: string
      type: 'confirm'
      confirmationType: ConfirmType
      projectName: string
      subtitle: string
      description: string
      sseUrl: string
      sseBody: string
    }

export interface PendingConfirmation {
  toolName: string
  projectName: string
}

export interface ChatResponse {
  reply: string
  pendingConfirmation?: PendingConfirmation
  toolResults?: Array<{ toolName: string; target?: string; result: unknown }>
}
