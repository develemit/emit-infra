interface MobileStepperProps {
  steps: number
  current: number
}

export function MobileStepper({ steps, current }: MobileStepperProps) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: steps }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-full"
          style={{ height: 4, background: i + 1 <= current ? 'var(--accent)' : 'var(--border)' }}
        />
      ))}
    </div>
  )
}
