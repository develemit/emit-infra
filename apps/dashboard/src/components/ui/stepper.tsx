import { Icon } from '@/components/icon'

interface StepperProps {
  steps: string[]
  current: number
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'active' : 'pending'
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="flex items-center justify-center rounded-full font-mono text-[12px]"
                style={{
                  width: 26,
                  height: 26,
                  background:
                    state === 'active' ? 'var(--accent)'
                    : state === 'done' ? 'var(--accent-soft)'
                    : 'var(--bg-elev)',
                  color:
                    state === 'active' ? 'var(--accent-fg)'
                    : state === 'done' ? 'var(--accent-bright)'
                    : 'var(--fg-subtle)',
                }}
              >
                {state === 'done' ? <Icon name="check" size={13} /> : n}
              </div>
              <span
                className="text-[13px]"
                style={{ color: state === 'active' ? 'var(--fg)' : 'var(--fg-muted)' }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="flex-1 mx-3"
                style={{ height: 1, background: n < current ? 'var(--accent-line)' : 'var(--border)', minWidth: 16 }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
