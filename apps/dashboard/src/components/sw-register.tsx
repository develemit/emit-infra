'use client'
import { useEffect } from 'react'

export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // The service worker cache-firsts /_next/static chunks. That's correct for
    // production (hashed filenames) but in dev the dev server reuses chunk URLs
    // while their contents change on each rebuild, so a cached chunk gets served
    // against a mismatched runtime → "Cannot read properties of undefined
    // (reading 'call')". Never run the SW in dev: tear down any existing
    // registration and purge its caches so a previously-installed SW can't
    // keep poisoning the page.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      if ('caches' in window) {
        void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      }
      return
    }

    navigator.serviceWorker.register('/sw.js').catch(console.error)
  }, [])

  return null
}
