interface Tab {
  value: string
  label: string
  count?: number
}

interface FilterTabsProps {
  tabs: Tab[]
  value: string
  onChange: (value: string) => void
}

export function FilterTabs({ tabs, value, onChange }: FilterTabsProps) {
  return (
    <div className="flex items-center gap-1 mb-4">
      {tabs.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          disabled={tab.count === undefined}
          className={`text-[12px] font-mono px-3 py-1 rounded-lg border transition-colors ${
            value === tab.value
              ? 'bg-card-2 border-border text-fg'
              : 'border-transparent text-subtle hover:text-fg hover:border-border'
          }`}
        >
          {tab.count !== undefined ? `${tab.label} (${tab.count})` : tab.label}
        </button>
      ))}
    </div>
  )
}
