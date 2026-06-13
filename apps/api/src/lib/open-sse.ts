import type { ServerResponse } from 'node:http'
import { writeEvent } from './write-sse.js'

export function sseError(raw: ServerResponse, message: string) {
  writeEvent(raw, { type: 'error', message })
  writeEvent(raw, { type: 'done', exitCode: 1 })
  raw.end()
}

export function openSse(reply: { hijack(): void; raw: ServerResponse }) {
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
}
