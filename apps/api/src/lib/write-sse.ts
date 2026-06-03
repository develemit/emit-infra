import type { ServerResponse } from 'node:http'

export type SseEvent =
  | { type: 'line'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export function writeEvent(raw: ServerResponse, event: SseEvent): void {
  raw.write(`data: ${JSON.stringify(event)}\n\n`)
}
