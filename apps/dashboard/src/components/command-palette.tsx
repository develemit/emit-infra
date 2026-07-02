'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/icon'
import { getProjects } from '@/lib/api'
import { STATIC_ITEMS, buildProjectItems, filterItems, type PaletteItem } from '@/lib/palette-items'

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [projectItems, setProjectItems] = useState<PaletteItem[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(o => (o ? false : o))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    setQuery('')
    setSelected(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || projectItems !== null) return
    getProjects()
      .then(ps => setProjectItems(buildProjectItems(ps.map(p => p.config.name))))
      .catch(() => setProjectItems([]))
  }, [open, projectItems])

  const items = useMemo(
    () => filterItems([...STATIC_ITEMS, ...(projectItems ?? [])], query),
    [projectItems, query],
  )

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function navigate(item: PaletteItem) {
    router.push(item.href)
    setOpen(false)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      const item = items[selected]
      if (item) navigate(item)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mx-auto mt-[15vh] w-[min(560px,calc(100vw-32px))] rounded-xl bg-card border border-border shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Icon name="search" size={14} className="text-subtle shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onInputKeyDown}
            aria-label="Search projects and pages"
            placeholder="Go to project or page…"
            className="w-full bg-transparent py-3 text-[13px] text-fg placeholder:text-subtle focus:outline-none"
          />
          <kbd className="hidden sm:block shrink-0 text-[10px] font-mono text-subtle border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-[320px] overflow-y-auto py-1"
        >
          {items.length === 0 && (
            <div className="px-3 py-4 text-[12px] font-mono text-subtle">
              {projectItems === null ? 'Loading projects…' : 'No matches'}
            </div>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              role="option"
              aria-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onClick={() => navigate(item)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
                i === selected ? 'bg-card-hover text-fg' : 'text-subtle'
              }`}
            >
              <Icon name={item.icon} size={14} className="shrink-0" />
              <span className="font-mono truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
