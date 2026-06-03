'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getContainers, openSseStream } from '@/lib/api'

type SseParsed =
  | { type: 'line'; stream: string; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export default function LogsPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [follow, setFollow] = useState(true)
  const [service, setService] = useState('')
  const [services, setServices] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    getContainers(name)
      .then((cs) => setServices(cs.map((c) => c.name)))
      .catch(() => {})
  }, [name])

  const stop = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setRunning(false)
  }, [])

  const start = useCallback(() => {
    if (esRef.current) return
    const path = `/projects/${encodeURIComponent(name)}/logs${service ? `?service=${encodeURIComponent(service)}` : ''}`
    const es = openSseStream(path)
    esRef.current = es
    setRunning(true)
    es.onmessage = (e: MessageEvent<string>) => {
      const ev = JSON.parse(e.data) as SseParsed
      if (ev.type === 'line') {
        setLines((prev) => [...prev, ev.text])
      } else {
        stop()
      }
    }
    es.onerror = () => stop()
  }, [name, service, stop])

  useEffect(() => {
    start()
    return stop
  }, [start, stop])

  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, follow])

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full max-w-3xl">
      <Link
        href={`/projects/${encodeURIComponent(name)}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-5"
      >
        <ArrowLeft size={14} />
        {name}
      </Link>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-xl font-semibold flex-1">Logs</h1>
        {services.length > 0 && (
          <select
            value={service}
            onChange={(e) => {
              stop()
              setService(e.target.value)
              setLines([])
            }}
            className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1"
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="rounded"
          />
          Follow
        </label>
        <button
          onClick={running ? stop : start}
          className="text-sm px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>

      <div className="font-mono text-xs bg-gray-950 text-gray-100 rounded-lg p-3 flex-1 overflow-y-auto min-h-[300px]">
        {lines.length === 0 ? (
          <span className="text-gray-600">{running ? 'Connecting...' : 'No output yet'}</span>
        ) : (
          lines.map((l, i) => <div key={i}>{l}</div>)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
