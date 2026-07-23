import { describe, it, expect } from 'vitest'
import { normalizeConfig, diffConfigLines } from './nginx-diff.js'

describe('normalizeConfig', () => {
  it('strips trailing whitespace per line', () => {
    expect(normalizeConfig('foo  \nbar\t\n')).toEqual(['foo', 'bar'])
  })

  it('drops trailing blank lines but keeps interior ones', () => {
    expect(normalizeConfig('foo\n\nbar\n\n\n')).toEqual(['foo', '', 'bar'])
  })

  it('does not strip comments', () => {
    expect(normalizeConfig('# a comment\nlisten 80;')).toEqual(['# a comment', 'listen 80;'])
  })
})

describe('diffConfigLines', () => {
  it('returns empty diff for identical input', () => {
    expect(diffConfigLines(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('treats trailing-whitespace-only differences as identical once normalized', () => {
    const local = normalizeConfig('listen 80;\nserver_name foo;  ')
    const server = normalizeConfig('listen 80;\nserver_name foo;')
    expect(diffConfigLines(local, server)).toEqual([])
  })

  it('reports an added line', () => {
    expect(diffConfigLines(['a', 'b'], ['a'])).toEqual(['  a', '+ b'])
  })

  it('reports a removed line', () => {
    expect(diffConfigLines(['a'], ['a', 'b'])).toEqual(['  a', '- b'])
  })

  it('reports a changed line as remove + add', () => {
    expect(diffConfigLines(['a', 'x'], ['a', 'y'])).toEqual(['  a', '- y', '+ x'])
  })

  it('truncates past maxLines with a marker', () => {
    const local = Array.from({ length: 10 }, (_, i) => `line${i}-local`)
    const server = Array.from({ length: 10 }, (_, i) => `line${i}-server`)
    const diff = diffConfigLines(local, server, 5)
    expect(diff).toHaveLength(6)
    expect(diff[5]).toBe('... (15 more lines)')
  })
})
