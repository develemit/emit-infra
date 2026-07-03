'use client'
import { useState } from 'react'

interface Props {
  initialNote: string
  initialFalsePositive: boolean
  onSave: (note: string, falsePositive: boolean) => Promise<void>
  onCancel: () => void
}

export function IncidentAnnotationForm({ initialNote, initialFalsePositive, onSave, onCancel }: Props) {
  const [note, setNote] = useState(initialNote)
  const [falsePositive, setFalsePositive] = useState(initialFalsePositive)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(note, falsePositive)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 p-2 rounded-lg bg-card-hover border border-border text-[12px]">
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        maxLength={500}
        placeholder="Root cause / notes…"
        rows={2}
        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-[12px] text-fg font-mono resize-none focus:outline-none focus:border-accent"
      />
      <label className="flex items-center gap-2 cursor-pointer text-subtle">
        <input
          type="checkbox"
          checked={falsePositive}
          onChange={e => setFalsePositive(e.target.checked)}
          className="rounded"
        />
        Mark as false positive
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-fg/10 hover:bg-fg/15 text-fg transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-2.5 py-1 rounded-lg text-[11px] text-subtle hover:text-fg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
