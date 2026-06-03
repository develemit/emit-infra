import { Icon } from '@/components/icon'

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="text-[13.5px] text-accent-fg bg-accent rounded-2xl px-3.5 py-2.5 whitespace-pre-wrap"
        style={{ maxWidth: '86%', borderBottomRightRadius: 4 }}
      >
        {text}
      </div>
    </div>
  )
}

export function ClaudeMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-2.5">
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-soft)' }}
      >
        <Icon name="zap" size={13} style={{ color: 'var(--accent-bright)' }} />
      </div>
      <div
        className="text-[13.5px] text-fg rounded-2xl px-3.5 py-2.5 border border-border whitespace-pre-wrap"
        style={{ maxWidth: '86%', background: 'var(--card-2)', borderBottomLeftRadius: 4 }}
      >
        {children}
      </div>
    </div>
  )
}
