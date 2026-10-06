import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { sendEmail, type EmailResult } from './email.js'
import { renderCombinedEmail, type OutboxEmail } from './email-templates/combined.js'
import type { RenderedEmail } from './email-templates/types.js'
import type { Tone } from './email-templates/layout.js'

export type QueuedResult = { queued: true }
export type SendFn = (email: RenderedEmail) => Promise<EmailResult>

interface PersistedState {
  lastSentAt: number
  failedWindows: number
  pending: OutboxEmail[]
}

export interface Outbox {
  enqueue(email: RenderedEmail, tone: Tone): Promise<EmailResult | QueuedResult>
  flush(): Promise<void>
  idle(): Promise<void>
  start(): Promise<void>
  stop(): void
}

export interface OutboxOptions {
  send?: SendFn
  now?: () => number
  file?: string
  intervalMs?: number
  log?: (msg: string) => void
}

const MARGIN_MS = 15_000
const MAX_FAILED_WINDOWS = 3

export function defaultIntervalMs(): number {
  const sec = Number(process.env['ALERT_EMAIL_MIN_INTERVAL_SEC'] ?? 315)
  return (Number.isFinite(sec) && sec > 0 ? sec : 315) * 1000
}

export function createOutbox(opts: OutboxOptions = {}): Outbox {
  const send = opts.send ?? sendEmail
  const now = opts.now ?? Date.now
  const file = opts.file ?? join(homedir(), '.emit-infra', 'email-outbox.json')
  const intervalMs = opts.intervalMs ?? defaultIntervalMs()
  const log = opts.log ?? ((m: string) => console.error(m))
  let state: PersistedState = { lastSentAt: 0, failedWindows: 0, pending: [] }
  let timer: NodeJS.Timeout | null = null
  let busy: Promise<void> = Promise.resolve()

  async function persist(): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 })
    await rename(tmp, file)
  }

  async function load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as PersistedState
      if (Array.isArray(parsed.pending)) state = { lastSentAt: parsed.lastSentAt ?? 0, failedWindows: parsed.failedWindows ?? 0, pending: parsed.pending }
    } catch {
      /* no outbox yet */
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (state.pending.length === 0) return
    const delay = Math.max(0, state.lastSentAt + intervalMs + MARGIN_MS - now())
    timer = setTimeout(() => void flush(), delay)
    timer.unref()
  }

  async function attempt(items: OutboxEmail[]): Promise<EmailResult> {
    const email = items.length === 1 ? items[0]! : renderCombinedEmail(items)
    return send(email).catch((err: unknown): EmailResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  }

  async function doFlush(): Promise<void> {
    if (state.pending.length === 0) return
    const items = state.pending
    const result = await attempt(items)
    if (result.ok) {
      state = { lastSentAt: now(), failedWindows: 0, pending: [] }
    } else {
      state = { ...state, lastSentAt: now(), failedWindows: state.failedWindows + 1 }
      if (state.failedWindows >= MAX_FAILED_WINDOWS) log(`email-outbox: ${state.failedWindows} failed windows, keeping ${items.length} item(s): ${result.error}`)
    }
    await persist()
    schedule()
  }

  function flush(): Promise<void> {
    busy = busy.then(doFlush, doFlush)
    return busy
  }

  async function enqueue(email: RenderedEmail, tone: Tone): Promise<EmailResult | QueuedResult> {
    const run = async (): Promise<EmailResult | QueuedResult> => {
      const item: OutboxEmail = { ...email, tone }
      const open = state.pending.length === 0 && now() - state.lastSentAt > intervalMs + MARGIN_MS
      if (!open) {
        state.pending.push(item)
        await persist()
        schedule()
        return { queued: true }
      }
      const result = await attempt([item])
      if (result.ok) {
        state.lastSentAt = now()
        state.failedWindows = 0
        await persist()
        return result
      }
      if (result.retryable) {
        state = { ...state, lastSentAt: now(), pending: [item] }
        await persist()
        schedule()
        return { queued: true }
      }
      return result
    }
    const p = busy.then(run, run)
    busy = p.then(() => undefined, () => undefined)
    return p
  }

  async function start(): Promise<void> {
    await load()
    schedule()
    if (state.pending.length > 0 && now() - state.lastSentAt > intervalMs + MARGIN_MS) await flush()
  }

  return { enqueue, flush, idle: () => busy, start, stop: () => { if (timer) clearTimeout(timer); timer = null } }
}

let shared: Outbox | null = null
export function getOutbox(): Outbox {
  return (shared ??= createOutbox())
}
export function resetOutboxForTests(): void {
  shared?.stop()
  shared = null
}
