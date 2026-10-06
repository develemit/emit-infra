import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOutbox } from './email-outbox.js'
import type { EmailResult } from './email.js'
import type { RenderedEmail } from './email-templates/types.js'

const INTERVAL = 300_000
const WINDOW = INTERVAL + 15_000
const mail = (name: string): RenderedEmail => ({ subject: `[emit-infra] 🔴 ${name} DOWN`, html: `<body>${name}</body>`, text: name })

describe('email outbox', () => {
  let dir: string
  let file: string
  let clock: number
  const sent: RenderedEmail[] = []
  let results: EmailResult[]
  const send = vi.fn(async (e: RenderedEmail): Promise<EmailResult> => {
    const r = results.shift() ?? { ok: true }
    if (r.ok) sent.push(e)
    return r
  })
  const make = (log: (m: string) => void = () => {}) => (current = createOutbox({ send, now: () => clock, file, intervalMs: INTERVAL, log }))

  beforeEach(async () => {
    vi.useFakeTimers()
    dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    file = join(dir, 'outbox.json')
    clock = 1_000_000_000
    sent.length = 0
    results = []
    send.mockClear()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(dir, { recursive: true, force: true })
  })

  let current: ReturnType<typeof createOutbox> | null = null
  const advance = async (ms: number) => {
    clock += ms
    await vi.advanceTimersByTimeAsync(ms)
    await current?.idle()
  }

  it('sends the first email immediately', async () => {
    const o = make()
    expect(await o.enqueue(mail('a'), 'critical')).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    o.stop()
  })

  it('combines two more within the window into one send at lastSentAt + window', async () => {
    const o = make()
    await o.enqueue(mail('a'), 'critical')
    expect(await o.enqueue(mail('b'), 'warning')).toEqual({ queued: true })
    expect(await o.enqueue(mail('c'), 'critical')).toEqual({ queued: true })
    await advance(WINDOW - 1000)
    expect(sent).toHaveLength(1)
    await advance(1000)
    expect(sent).toHaveLength(2)
    expect(sent[1]!.subject).toContain('2 alerts')
    expect(sent[1]!.text).toContain('b')
    expect(sent[1]!.text).toContain('c')
    o.stop()
  })

  it('sends a single pending item as-is', async () => {
    const o = make()
    await o.enqueue(mail('a'), 'critical')
    await o.enqueue(mail('b'), 'critical')
    await advance(WINDOW)
    expect(sent[1]).toMatchObject({ subject: mail('b').subject })
    o.stop()
  })

  it('requeues on cooldown and retries next window without dropping', async () => {
    const o = make()
    await o.enqueue(mail('a'), 'critical')
    await o.enqueue(mail('b'), 'critical')
    results = [{ ok: false, error: '429', retryable: true }]
    await advance(WINDOW)
    expect(sent).toHaveLength(1)
    await advance(WINDOW)
    expect(sent).toHaveLength(2)
    expect(sent[1]!.text).toBe('b')
    o.stop()
  })

  it('queues when the very first send hits a cooldown', async () => {
    const o = make()
    results = [{ ok: false, error: 'cooldown', retryable: true }]
    expect(await o.enqueue(mail('a'), 'critical')).toEqual({ queued: true })
    await advance(WINDOW)
    expect(sent).toHaveLength(1)
    o.stop()
  })

  it('keeps items after 3 failed windows and logs', async () => {
    const log = vi.fn()
    const o = make(log)
    await o.enqueue(mail('a'), 'critical')
    await o.enqueue(mail('b'), 'critical')
    results = Array.from({ length: 3 }, () => ({ ok: false as const, error: '429', retryable: true }))
    for (let i = 0; i < 3; i++) await advance(WINDOW)
    expect(log).toHaveBeenCalled()
    await advance(WINDOW)
    expect(sent).toHaveLength(2)
    o.stop()
  })

  it('pending items survive a restart', async () => {
    const first = make()
    await first.enqueue(mail('a'), 'critical')
    await first.enqueue(mail('b'), 'critical')
    first.stop()
    const second = make()
    await second.start()
    await advance(WINDOW)
    expect(sent).toHaveLength(2)
    expect(sent[1]!.text).toBe('b')
    second.stop()
  })

  it('flushes overdue pending items on startup', async () => {
    const first = make()
    await first.enqueue(mail('a'), 'critical')
    await first.enqueue(mail('b'), 'critical')
    first.stop()
    clock += WINDOW * 2
    const second = make()
    await second.start()
    expect(sent).toHaveLength(2)
    second.stop()
  })

  it('an empty flush is a no-op', async () => {
    const o = make()
    await o.flush()
    expect(send).not.toHaveBeenCalled()
  })
})
