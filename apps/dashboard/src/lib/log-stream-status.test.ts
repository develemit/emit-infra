import { describe, it, expect } from 'vitest'
import { nextLogStreamStatus } from './log-stream-status'

describe('nextLogStreamStatus', () => {
  it('starts connecting', () => {
    expect(nextLogStreamStatus('live', { type: 'start' })).toBe('connecting')
  })

  it('goes live once a line arrives', () => {
    expect(nextLogStreamStatus('connecting', { type: 'line' })).toBe('live')
  })

  it('never shows live over a dead connection: a done with a nonzero exit code is an error', () => {
    expect(nextLogStreamStatus('connecting', { type: 'done', exitCode: 255 })).toBe('error')
  })

  it('a clean done with exit code 0 goes back to connecting, not error', () => {
    expect(nextLogStreamStatus('live', { type: 'done', exitCode: 0 })).toBe('connecting')
  })

  it('an explicit stream error event sets error state', () => {
    expect(nextLogStreamStatus('live', { type: 'stream-error' })).toBe('error')
  })

  it('an explicit stream error while still connecting sets error state', () => {
    expect(nextLogStreamStatus('connecting', { type: 'stream-error' })).toBe('error')
  })

  it('a stray line after an error does not revert to live', () => {
    expect(nextLogStreamStatus('error', { type: 'line' })).toBe('error')
  })
})
