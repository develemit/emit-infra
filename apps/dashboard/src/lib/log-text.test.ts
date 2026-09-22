import { describe, it, expect } from 'vitest'
import { stripAnsi, filterLines, logFilename, splitByMatch } from './log-text'

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok')
  })

  it('removes multiple codes in one line', () => {
    expect(stripAnsi('\x1b[1m\x1b[31mfail\x1b[0m: boom')).toBe('fail: boom')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain line, no codes')).toBe('plain line, no codes')
  })
})

describe('filterLines', () => {
  const lines = ['Building image', 'ERROR: build failed', 'Retrying build', 'done']

  it('returns every index when the query is empty', () => {
    expect(filterLines(lines, '')).toEqual([0, 1, 2, 3])
  })

  it('returns only indexes of matching lines', () => {
    expect(filterLines(lines, 'build')).toEqual([0, 1, 2])
  })

  it('matches case-insensitively', () => {
    expect(filterLines(lines, 'ERROR')).toEqual([1])
    expect(filterLines(lines, 'error')).toEqual([1])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterLines(lines, 'nope')).toEqual([])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(filterLines(lines, '  done  ')).toEqual([3])
  })
})

describe('logFilename', () => {
  it('builds <project>-<type>-<shortsha>.log', () => {
    expect(logFilename('tastease', 'deploy', 'abc1234567890')).toBe('tastease-deploy-abc1234.log')
  })

  it('works for ci logs', () => {
    expect(logFilename('tastease', 'ci', 'deadbeef')).toBe('tastease-ci-deadbee.log')
  })

  it('does not pad short shas', () => {
    expect(logFilename('tastease', 'deploy', 'abc12')).toBe('tastease-deploy-abc12.log')
  })
})

describe('splitByMatch', () => {
  it('returns the whole line unmatched when the query is empty', () => {
    expect(splitByMatch('hello world', '')).toEqual([{ text: 'hello world', match: false }])
  })

  it('splits a single match out of the line', () => {
    expect(splitByMatch('hello world', 'world')).toEqual([
      { text: 'hello ', match: false },
      { text: 'world', match: true },
    ])
  })

  it('matches case-insensitively but preserves original casing', () => {
    expect(splitByMatch('Hello World', 'world')).toEqual([
      { text: 'Hello ', match: false },
      { text: 'World', match: true },
    ])
  })

  it('handles repeated matches', () => {
    expect(splitByMatch('foo foo foo', 'foo')).toEqual([
      { text: 'foo', match: true },
      { text: ' ', match: false },
      { text: 'foo', match: true },
      { text: ' ', match: false },
      { text: 'foo', match: true },
    ])
  })

  it('returns no match when the query is absent', () => {
    expect(splitByMatch('nothing here', 'zzz')).toEqual([{ text: 'nothing here', match: false }])
  })
})
