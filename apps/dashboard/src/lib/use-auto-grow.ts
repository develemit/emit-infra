import { useLayoutEffect, useRef } from 'react'

export function useAutoGrowTextarea(value: string, maxRows: number) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '16')
    const maxHeight = lineHeight * maxRows
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, maxRows])

  return ref
}
