import { FETCH_ERROR_MESSAGES, type FetchErrorKind } from '@/lib/fetch-result'

export type PanelStateKind = FetchErrorKind | 'empty'

const LABELS: Record<PanelStateKind, string> = {
  ...FETCH_ERROR_MESSAGES,
  empty: 'Nothing here yet',
}

interface PanelStateProps {
  kind: PanelStateKind
  message?: string
}

export function PanelState({ kind, message }: PanelStateProps) {
  const isAlert = kind === 'unreachable' || kind === 'error'
  return (
    <div className={`text-[12px] font-mono ${isAlert ? 'text-err' : 'text-subtle'}`}>
      {message ?? LABELS[kind]}
    </div>
  )
}
