'use client'
import { Icon } from '@/components/icon'

interface ConfirmDialogProps {
  title: string
  subtitle?: string
  icon?: string
  tone?: 'default' | 'warn'
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: React.ReactNode
}

// z-[60] and the extra bottom padding keep this above the mobile tab bar
// (fixed, z-50) — same z-index would let the tab bar paint on top and eat
// taps meant for the dialog's footer buttons.
export function ConfirmDialog({
  title,
  subtitle,
  icon = 'alert',
  tone = 'default',
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const badgeStyle = tone === 'warn'
    ? { background: 'var(--warn-soft)', border: '1px solid var(--warn)', color: 'var(--warn)' }
    : { background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', color: 'var(--accent-bright)' }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-4 pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] sm:pb-4"
    >
      <div
        className="w-full flex flex-col rounded-2xl border overflow-hidden"
        style={{ maxWidth: 440, maxHeight: '90vh', background: 'var(--card)', borderColor: 'var(--border-strong)' }}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center justify-center rounded-[9px] shrink-0" style={{ width: 34, height: 34, ...badgeStyle }}>
            <Icon name={icon} size={17} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-fg">{title}</div>
            {subtitle && <div className="text-[11.5px] font-mono text-subtle">{subtitle}</div>}
          </div>
          <div className="flex-1" />
          <button onClick={onCancel} disabled={busy} className="text-subtle hover:text-fg transition-colors disabled:opacity-40">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5 overflow-y-auto flex-1 text-[13px] text-muted leading-[1.55]">
          {children}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-lg text-[13px] font-medium text-subtle border border-border hover:bg-card-hover disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
