'use client'
import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
const KEY = 'ec-theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Theme | null
    const t = stored ?? 'dark'
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
  }, [])

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem(KEY, next)
  }

  return { theme, toggleTheme }
}
