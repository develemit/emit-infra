'use client'
import { useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

const LIGHTS = ['#ff5f57', '#febc2e', '#28c840']

interface TerminalProps {
  title?: string
  running?: boolean
  exit?: number
  children?: React.ReactNode
  bodyStyle?: React.CSSProperties
  style?: React.CSSProperties
  bar?: boolean
  footer?: boolean
  className?: string
}

export function Terminal({
  title,
  running,
  exit,
  children,
  bodyStyle,
  style,
  bar = true,
  footer = true,
  className,
}: TerminalProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (running && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  })

  return (
    <div className={cn('ec-term', className)} style={style}>
      {bar && (
        <div className="ec-term-bar">
          <span className="ec-term-lights">
            {LIGHTS.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </span>
          <span className="ec-term-title">{title}</span>
          {running && <span className="ec-term-live">● live</span>}
        </div>
      )}

      <div ref={bodyRef} className="ec-term-body" style={bodyStyle}>
        {children}
        {running && (
          <div className="ec-ln">
            <span style={{ color: 'var(--term-dim)' }}>$ </span>
            <span className="ec-caret" />
          </div>
        )}
        {footer && (running || exit !== undefined) && (
          <div style={{ marginTop: 10 }}>
            {running ? (
              <span className="ec-exit streaming">
                <span className="ec-spinner" />streaming…
              </span>
            ) : (
              <span className={cn('ec-exit', exit === 0 ? 'ok' : 'err')}>
                {exit === 0 ? '✔' : '✕'} exit {exit}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function TermLine({ ts, children }: { ts?: string; children: React.ReactNode }) {
  return (
    <div className="ec-ln">
      {ts && <span className="ec-ts">{ts}&nbsp;&nbsp;</span>}
      {children}
    </div>
  )
}
