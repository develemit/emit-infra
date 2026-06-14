'use client'

import { useCallback, useEffect, useState } from 'react'

type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushRequirement =
  | 'ready'
  | 'unsupported'
  | 'ios-needs-pwa'
  | 'permission-denied'
  | 'permission-needed'

export interface UsePushNotifications {
  permission: Permission
  requirement: PushRequirement
  subscribed: boolean
  busy: boolean
  error: string | null
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
}

function detectRequirement(): PushRequirement {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported'
  }
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(/CriOS|FxiOS/.test(ua) && !/Safari/.test(ua))
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ((window.navigator as unknown as { standalone?: boolean }).standalone === true)
  if (isIOS && !isStandalone) return 'ios-needs-pwa'
  const perm = Notification.permission as Permission
  if (perm === 'denied') return 'permission-denied'
  if (perm === 'default') return 'permission-needed'
  return 'ready'
}

function guessDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'device'
  const ua = navigator.userAgent
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'device'
}

export function usePushNotifications(): UsePushNotifications {
  const [permission, setPermission] = useState<Permission>('default')
  const [requirement, setRequirement] = useState<PushRequirement>('permission-needed')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRequirement(detectRequirement())
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission as Permission)
    }
    void (async () => {
      try {
        if (!('serviceWorker' in navigator)) return
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager.getSubscription()
        setSubscribed(!!sub)
      } catch { /* non-fatal */ }
    })()
  }, [])

  const subscribe = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm as Permission)
      if (perm !== 'granted') { setRequirement(detectRequirement()); return }

      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready

      const vapidRes = await fetch('/api/push/vapid')
      if (!vapidRes.ok) throw new Error('failed to fetch VAPID key')
      const { publicKey } = (await vapidRes.json()) as { publicKey: string }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      })

      const json = sub.toJSON()
      const postRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: guessDeviceLabel() }),
      })
      if (!postRes.ok) throw new Error('server rejected subscription')

      setSubscribed(true)
      setRequirement('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'subscribe failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unsubscribe failed')
    } finally {
      setBusy(false)
    }
  }, [])

  return { permission, requirement, subscribed, busy, error, subscribe, unsubscribe }
}
