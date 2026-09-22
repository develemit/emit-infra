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
