'use client'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon } from '@/components/icon'

interface ChipInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

export function ChipInput({ values, onChange, placeholder = 'add…' }: ChipInputProps) {
  const [draft, setDraft] = useState('')

  function add() {
    const v = draft.trim().replace(/,$/, '')
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 p-2 rounded-lg"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border-strong)',
        minHeight: 40,
      }}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[12px] bg-accent-soft text-accent-bright"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="hover:text-fg transition-colors"
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 bg-transparent text-[12px] font-mono text-fg outline-none"
        style={{ height: 26, minWidth: 90, padding: '0 4px' }}
      />
    </div>
  )
}
