import { useEffect, useRef } from 'react'

interface Options<T> {
  method?: 'GET' | 'POST'
  enabled?: boolean
  body?: string
  headers?: Record<string, string>
  onEvent: (ev: T) => void
}

export function useSseStream<T>(
  url: string,
  { method = 'POST', enabled = true, body, headers, onEvent }: Options<T>,
): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const headersRef = useRef(headers)
  headersRef.current = headers

  useEffect(() => {
    if (!enabled || !url) return
    const ctrl = new AbortController()

    async function run() {
      try {
        const init: RequestInit = { method, signal: ctrl.signal }
        if (headersRef.current) init.headers = headersRef.current
        if (body !== undefined) init.body = body

        const res = await fetch(url, init)
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.split('\n').find(l => l.startsWith('data:'))
            if (!line) continue
            try {
              onEventRef.current(JSON.parse(line.slice(5).trim()) as T)
            } catch {
              // malformed frame — skip
            }
          }
        }
      } catch {
        // aborted or network error
      }
    }

    void run()
    return () => ctrl.abort()
  }, [url, method, enabled, body])
}
