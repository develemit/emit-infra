/**
 * Web Push subscription + delivery layer.
 *
 * VAPID keys + subscriptions are persisted to ~/.emit-infra/push.json so they
 * survive API restarts. Keys are generated lazily on first read.
 *
 * iOS note: Web Push works in Safari from iOS 16.4+ ONLY when the dashboard
 * is installed as a PWA (Add to Home Screen). Regular browser-tab pushes
 * won't work on iOS. Other platforms (Android Chrome, desktop browsers)
 * work in regular browser tabs.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import webPush, { type PushSubscription as WPSub } from 'web-push'

const PUSH_DIR = path.join(os.homedir(), '.emit-infra')
const PUSH_FILE = path.join(PUSH_DIR, 'push.json')

interface StoredSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  label?: string
  addedAtISO: string
}

interface PushStore {
  vapid: { publicKey: string; privateKey: string }
  subject: string
  subscriptions: StoredSubscription[]
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

const VAPID_SUBJECT = 'mailto:emitdutcher@gmail.com'

function loadOrInit(): PushStore {
  try {
    const store = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')) as PushStore
    if (store.subject !== VAPID_SUBJECT) {
      store.subject = VAPID_SUBJECT
      fs.writeFileSync(PUSH_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
    }
    return store
  } catch {
    fs.mkdirSync(PUSH_DIR, { recursive: true })
    const keys = webPush.generateVAPIDKeys()
    const store: PushStore = { vapid: keys, subject: VAPID_SUBJECT, subscriptions: [] }
    fs.writeFileSync(PUSH_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
    return store
  }
}

function save(store: PushStore): void {
  fs.writeFileSync(PUSH_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
}

let cached: PushStore | null = null
function getStore(): PushStore {
  if (!cached) cached = loadOrInit()
  return cached
}

export function getPublicKey(): string {
  return getStore().vapid.publicKey
}

export function addSubscription(sub: StoredSubscription): void {
  const store = getStore()
  store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== sub.endpoint)
  store.subscriptions.push(sub)
  save(store)
}

export function removeSubscription(endpoint: string): boolean {
  const store = getStore()
  const before = store.subscriptions.length
  store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint)
  if (store.subscriptions.length === before) return false
  save(store)
  return true
}

export function listSubscriptions(): StoredSubscription[] {
  return [...getStore().subscriptions]
}

export async function sendToAll(payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  const store = getStore()
  if (store.subscriptions.length === 0) return { sent: 0, pruned: 0 }

  webPush.setVapidDetails(store.subject, store.vapid.publicKey, store.vapid.privateKey)

  const body = JSON.stringify(payload)
  let sent = 0
  const deadEndpoints: string[] = []

  await Promise.all(
    store.subscriptions.map(async (sub) => {
      const wp: WPSub = { endpoint: sub.endpoint, keys: sub.keys }
      try {
        await webPush.sendNotification(wp, body)
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) deadEndpoints.push(sub.endpoint)
      }
    }),
  )

  if (deadEndpoints.length > 0) {
    store.subscriptions = store.subscriptions.filter((s) => !deadEndpoints.includes(s.endpoint))
    save(store)
  }

  return { sent, pruned: deadEndpoints.length }
}
