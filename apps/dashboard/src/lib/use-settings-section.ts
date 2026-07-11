'use client'
import { useState } from 'react'

export interface SectionState {
  saving: boolean
  saved: boolean
  error: string | null
}

export function useSettingsSection(fn: () => Promise<void>): [SectionState, () => void] {
  const [state, setState] = useState<SectionState>({ saving: false, saved: false, error: null })
  const save = () => {
    setState({ saving: true, saved: false, error: null })
    fn().then(() => {
      setState({ saving: false, saved: true, error: null })
      setTimeout(() => setState(s => ({ ...s, saved: false })), 2000)
    }).catch((err: unknown) => {
      setState({ saving: false, saved: false, error: err instanceof Error ? err.message : 'Save failed' })
    })
  }
  return [state, save]
}
