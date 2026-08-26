import { describe, it, expect } from 'vitest'
import { formatFatalError } from './fatal.js'

describe('formatFatalError', () => {
  it('captures message and stack for a real Error', () => {
    const err = new Error('boom')

    const record = formatFatalError(err)

    expect(record.message).toBe('boom')
    expect(record.stack).toContain('Error: boom')
    expect(record.raw).toBe(err)
  })

  it('handles an error with no stack', () => {
    const err = new Error('no stack here')
    delete err.stack

    const record = formatFatalError(err)

    expect(record.message).toBe('no stack here')
    expect(record.stack).toBeUndefined()
  })

  it('handles a non-Error thrown value', () => {
    const record = formatFatalError('just a string')

    expect(record.message).toBe('just a string')
    expect(record.stack).toBeUndefined()
    expect(record.raw).toBe('just a string')
  })

  it('handles a thrown object without a message property', () => {
    const thrown = { code: 'ECONNRESET' }

    const record = formatFatalError(thrown)

    expect(record.message).toBe('[object Object]')
    expect(record.raw).toBe(thrown)
  })
})
