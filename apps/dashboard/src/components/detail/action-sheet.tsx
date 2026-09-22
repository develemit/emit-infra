'use client'
import { Icon } from '@/components/icon'

interface ActionSheetProps {
  title: string
  subtitle?: string
  icon: string
  onClose: () => void
  closeDisabled?: boolean
  children: React.ReactNode
}

// Right-side drawer on desktop, bottom sheet on mobile. z-[60] and the mobile
// safe-area padding match ConfirmDialog/DestroyModal so this reliably paints
// above the fixed mobile tab bar and action bar regardless of DOM order (see
// sprint 349's z-index note on those two).
export function ActionSheet({ title, subtitle, icon, onClose, closeDisabled = false, children }: ActionSheetProps) {
  function handleBackdropClick() {
    if (!closeDisabled) onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={handleBackdropClick} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed z-[60] inset-x-0 bottom-0 top-[25%] flex flex-col rounded-t-2xl border-t border-strong bg-card shadow-[0_-20px_50px_rgba(0,0,0,.4)] lg:inset-x-auto lg:inset-y-0 lg:top-0 lg:right-0 lg:bottom-0 lg:w-[440px] lg:rounded-t-none lg:rounded-l-2xl lg:border-t-0 lg:border-l lg:shadow-[-20px_0_50px_rgba(0,0,0,.4)]"
      >
        <div className="flex justify-center pt-3 pb-2 lg:hidden">
          <div className="rounded-full" style={{ width: 36, height: 4, background: 'var(--border-strong)' }} />
        </div>
        <div className="flex items-center gap-2 px-4 lg:px-5 pb-3 lg:pt-4 border-b border-border shrink-0">
          <Icon name={icon} size={15} style={{ color: 'var(--accent-bright)' }} />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-fg truncate">{title}</div>
            {subtitle && <div className="text-[11px] font-mono text-subtle truncate">{subtitle}</div>}
          </div>
          <div className="flex-1" />
          {!closeDisabled && (
            <button onClick={onClose} className="text-subtle hover:text-fg transition-colors">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3 p-4 lg:p-5 overflow-y-auto flex-1 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:pb-5">
          {children}
        </div>
      </div>
    </>
  )
}
