'use client'
import { useEffect, useState } from 'react'
import { Terminal } from '@/components/ui/terminal'
import { getApiBase, authHeaders } from '@/lib/api'
import { useSseStream } from '@/lib/use-sse-stream'

interface ContainerLogViewerProps {
  projectName: string
  containerName: string
  onClose: () => void
}

type ContainerSseEvent =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

function useContainerLogs(url: string | null) {
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | undefined>()

  useEffect(() => {
    setLines([])
    setExit(undefined)
  }, [url])

  useSseStream<ContainerSseEvent>(url ?? '', {
    method: 'GET',
    headers: authHeaders(),
    enabled: !!url,
    onEvent(ev) {
      if (ev.type === 'line') setLines(p => [...p, ev.text])
      else if (ev.type === 'done') setExit(ev.exitCode)
      else if (ev.type === 'error') { setLines(p => [...p, `error: ${ev.message}`]); setExit(1) }
    },
  })

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
