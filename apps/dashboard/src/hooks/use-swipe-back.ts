'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

const MIN_SWIPE_DISTANCE = 80
const MAX_VERTICAL_DRIFT = 100

export function useSwipeBack() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/') return

    let startX = 0
    let startY = 0

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      if (!touch) return
      startX = touch.clientX
      startY = touch.clientY
    }

    function onTouchEnd(e: TouchEvent) {
      const touch = e.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - startX
      const dy = Math.abs(touch.clientY - startY)
      if (dx > MIN_SWIPE_DISTANCE && dy < MAX_VERTICAL_DRIFT) {
        router.back()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [router, pathname])
}
