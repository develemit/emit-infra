'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { SseEvent } from '@/lib/api'
import { cn } from '@/lib/utils'

interface SseLine {
  stream: 'stdout' | 'stderr'
  text: string
}

interface Props {
  url: string
  method?: 'GET' | 'POST'
  body?: string
  active: boolean
  onComplete?: (exitCode: number) => void
}

export function SseOutputPanel({ url, method = 'GET', body, active, onComplete }: Props) {
  const [lines, setLines] = useState<SseLine[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const clear = useCallback(() => {
    setLines([])
    setExitCode(null)
  }, [])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()

    fetch(url, {
      method,
      signal: controller.signal,
      ...(body !== undefined ? { body, headers: { 'Content-Type': 'application/json' } } : {}),
    })
      .then(async (res) => {
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const chunks = buf.split('\n\n')
          buf = chunks.pop() ?? ''
          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
            if (!dataLine) continue
            const ev = JSON.parse(dataLine.slice(6)) as SseEvent
            if (ev.type === 'line') {
              setLines((prev) => [...prev, { stream: ev.stream, text: ev.text }])
            } else if (ev.type === 'done') {
              setExitCode(ev.exitCode)
              onComplete?.(ev.exitCode)
            }
          }
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          setLines((prev) => [...prev, { stream: 'stderr', text: String(err) }])
        }
      })

    return () => controller.abort()
  }, [url, method, body, active, onComplete])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="rounded-lg border border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-700">
        <span className="text-xs text-gray-400 font-mono">output</span>
        <div className="flex items-center gap-2">
          {exitCode !== null && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded font-mono',
                exitCode === 0
                  ? 'bg-emerald-900/60 text-emerald-400'
                  : 'bg-red-900/60 text-red-400',
              )}
            >
              exit {exitCode}
            </span>
          )}
          <button onClick={clear} className="text-xs text-gray-500 hover:text-gray-300">
            clear
          </button>
        </div>
      </div>
      <div className="font-mono text-xs bg-gray-950 text-gray-100 p-3 h-56 overflow-y-auto">
        {lines.length === 0 ? (
          <span className="text-gray-600">
            {active ? 'Connecting...' : 'Output will appear here'}
          </span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={l.stream === 'stderr' ? 'text-red-400' : ''}>
              {l.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
