export type LogStreamStatus = 'connecting' | 'live' | 'error'

export type LogStreamEvent =
  | { type: 'start' }
  | { type: 'line' }
  | { type: 'done'; exitCode: number }
  | { type: 'stream-error' }

export function nextLogStreamStatus(status: LogStreamStatus, event: LogStreamEvent): LogStreamStatus {
  switch (event.type) {
    case 'start':
      return 'connecting'
    case 'line':
      return status === 'error' ? status : 'live'
    case 'done':
      return event.exitCode === 0 ? 'connecting' : 'error'
    case 'stream-error':
      return 'error'
  }
}

// A quiet project can legitimately have nothing to show yet — connecting,
// or live but between lines (e.g. right after a service filter clears the
// backlog). Either way that's not the same as being stuck, so the terminal
// needs its own "waiting" line rather than leaving the bare running prompt
// to stand in for both.
export function showsWaitingPlaceholder(lineCount: number, status: LogStreamStatus): boolean {
  return lineCount === 0 && status !== 'error'
}
