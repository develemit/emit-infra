import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fsState } = vi.hoisted(() => ({
  fsState: { content: null as string | null },
}))

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(() => {
      if (fsState.content === null) throw new Error('ENOENT')
      return fsState.content
    }),
    writeFileSync: vi.fn((_path: string, data: string) => {
      fsState.content = data
    }),
    mkdirSync: vi.fn(),
  },
}))

vi.mock('web-push', () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: 'pub', privateKey: 'priv' })),
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}))

function makeSub(endpoint: string) {
  return {
    endpoint,
    keys: { p256dh: 'p', auth: 'a' },
    addedAtISO: '2026-07-02T00:00:00Z',
  }
}

async function loadPush() {
  vi.resetModules()
  return import('./push.js')
}

describe('push subscription store cache', () => {
  beforeEach(() => {
    fsState.content = null
  })

  it('reflects an added subscription in the next read', async () => {
    const push = await loadPush()
    expect(push.listSubscriptions()).toEqual([])

    push.addSubscription(makeSub('https://ep/1'))

    const subs = push.listSubscriptions()
    expect(subs).toHaveLength(1)
    expect(subs[0]?.endpoint).toBe('https://ep/1')
  })

  it('reflects a removed subscription in the next read', async () => {
    const push = await loadPush()
    push.addSubscription(makeSub('https://ep/1'))
    push.addSubscription(makeSub('https://ep/2'))

    expect(push.removeSubscription('https://ep/1')).toBe(true)

    const subs = push.listSubscriptions()
    expect(subs).toHaveLength(1)
    expect(subs[0]?.endpoint).toBe('https://ep/2')
  })

  it('returns false when removing an unknown endpoint', async () => {
    const push = await loadPush()
    push.addSubscription(makeSub('https://ep/1'))

    expect(push.removeSubscription('https://ep/nope')).toBe(false)
    expect(push.listSubscriptions()).toHaveLength(1)
  })

  it('keeps the in-memory cache identical to what was persisted', async () => {
    const push = await loadPush()
    push.addSubscription(makeSub('https://ep/1'))

    const persisted = JSON.parse(fsState.content ?? '{}') as {
      subscriptions: Array<{ endpoint: string }>
    }
    expect(persisted.subscriptions.map((s) => s.endpoint)).toEqual(
      push.listSubscriptions().map((s) => s.endpoint),
    )
  })

  it('replaces a re-added endpoint instead of duplicating it', async () => {
    const push = await loadPush()
    push.addSubscription(makeSub('https://ep/1'))
    push.addSubscription({ ...makeSub('https://ep/1'), label: 'phone' })

    const subs = push.listSubscriptions()
    expect(subs).toHaveLength(1)
    expect(subs[0]?.label).toBe('phone')
  })
})
