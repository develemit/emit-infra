import { execa } from 'execa'
import { createInterface } from 'node:readline'
import type { SseEvent } from './write-sse.js'

export async function* streamProcess(
  command: string,
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal },
): AsyncGenerator<SseEvent> {
  const proc = execa(command, args, {
    ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options?.signal !== undefined ? { cancelSignal: options.signal } : {}),
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  })

  const queue: SseEvent[] = []
  let done = false
  let notify: (() => void) | null = null

  const wake = () => {
    const r = notify
    notify = null
    r?.()
  }
  const push = (ev: SseEvent) => {
    queue.push(ev)
    wake()
  }

  const rlOut = createInterface({ input: proc.stdout! })
  const rlErr = createInterface({ input: proc.stderr! })

  rlOut.on('line', (text) => push({ type: 'line', stream: 'stdout', text }))
  rlErr.on('line', (text) => push({ type: 'line', stream: 'stderr', text }))

  // Wait for both readline streams to drain fully before pushing done,
  // ensuring all line events have been emitted before the terminal event.
  void Promise.all([
    new Promise<void>((resolve) => rlOut.on('close', resolve)),
    new Promise<void>((resolve) => rlErr.on('close', resolve)),
    proc,
  ]).then(
    ([, , result]) => {
      push({ type: 'done', exitCode: result.exitCode ?? 0 })
      done = true
      wake()
    },
    (err: Error) => {
      push({ type: 'error', message: err.message })
      done = true
      wake()
    },
  )

  for (;;) {
    while (queue.length > 0) {
      const ev = queue.shift()!
      yield ev
      if (ev.type === 'done' || ev.type === 'error') return
    }
    if (done) return
    await new Promise<void>((r) => {
      notify = r
    })
  }
}
