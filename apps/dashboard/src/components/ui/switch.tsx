interface SwitchProps {
  on: boolean
  onChange: () => void
  label?: string
}

export function Switch({ on, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className="relative shrink-0 rounded-full transition-colors"
      style={{
        width: 38,
        height: 22,
        background: on ? 'var(--accent)' : 'var(--border-strong)',
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-[left]"
        style={{
          width: 18,
          height: 18,
          top: 2,
          left: on ? 18 : 2,
        }}
      />
    </button>
  )
}
