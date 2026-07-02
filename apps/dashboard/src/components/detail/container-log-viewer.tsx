'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { getApiBase, authHeaders } from '@/lib/api'

interface ContainerLogViewerProps {
  projectName: string
  containerName: string
  onClose: () => void
}

function useContainerLogs(url: string | null) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()

  useEffect(() => {
    if (!url) return
    const currentUrl = url
    setLines([])
    setExit(undefined)
    const ctrl = new AbortController()

    async function run() {
      try {
        const res = await fetch(currentUrl, { signal: ctrl.signal, headers: authHeaders() })
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
            const data = part.split('\n').find(l => l.startsWith('data:'))
            if (!data) continue
            const ev = JSON.parse(data.slice(5).trim()) as
              | { type: 'line'; stream: string; text: string }
              | { type: 'done'; exitCode: number }
              | { type: 'error'; message: string }
            if (ev.type === 'line') setLines(p => [...p, ev.text])
            else if (ev.type === 'done') setExit(ev.exitCode)
            else if (ev.type === 'error') { setLines(p => [...p, `error: ${ev.message}`]); setExit(1) }
          }
        }
      } catch {
        // aborted or network error
      }
    }

    void run()
    return () => ctrl.abort()
  }, [url])

  return { lines, exit }
}

export function ContainerLogViewer({ projectName, containerName, onClose }: ContainerLogViewerProps) {
  const url = `${getApiBase()}/projects/${encodeURIComponent(projectName)}/containers/${encodeURIComponent(containerName)}/logs`
  const { lines, exit } = useContainerLogs(url)

  return (
    <div className="mt-3">
      <Terminal
        title={containerName}
        running={exit === undefined}
        exit={exit}
        scrollBottom
      >
        {lines.map((l, i) => <div key={i} className="ec-ln">{l}</div>)}
      </Terminal>
      {exit !== undefined && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 h-[28px] rounded-lg text-[12px] font-medium text-subtle border border-border hover:text-fg transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
