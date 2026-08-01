import { describe, it, expect } from 'vitest'
import { parseEnvEntries } from './env-file.js'

describe('parseEnvEntries', () => {
  it('parses keys containing digits', () => {
    // Regression: an earlier /^\s*[A-Z_]+=/ filter dropped every one of these,
    // which made the env-removal guard report them as phantom removals (sprint 244).
    const entries = parseEnvEntries([
      'R2_BUCKET=my-bucket',
      'R2_ACCESS_KEY_ID=abc123',
      'S3_REGION=auto',
      'DATABASE_URL=postgres://x',
    ].join('\n'))

    expect(entries.map(([k]) => k).sort()).toEqual([
      'DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_BUCKET', 'S3_REGION',
    ])
    expect(entries.find(([k]) => k === 'R2_BUCKET')?.[1]).toBe('my-bucket')
  })

  it('skips comments, blanks and garbage lines', () => {
    const entries = parseEnvEntries([
      '# FOO=bar',
      '   # R2_COMMENTED=nope',
      '',
      '   ',
      'not an env line',
      '=leading-equals',
      '9STARTS_WITH_DIGIT=nope',
      'REAL_KEY=yes',
      'R2_ALSO_REAL=yes',
    ].join('\n'))

    expect(entries.map(([k]) => k).sort()).toEqual(['R2_ALSO_REAL', 'REAL_KEY'])
  })

  it('tolerates leading whitespace before the key', () => {
    const entries = parseEnvEntries('  R2_BUCKET=b\n\tDATABASE_URL=d\n')
    expect(entries.map(([k]) => k).sort()).toEqual(['DATABASE_URL', 'R2_BUCKET'])
  })

  it('returns an empty array for empty content', () => {
    expect(parseEnvEntries('')).toEqual([])
  })

  it('does not strip quotes — that is a caller-specific concern', () => {
    const entries = parseEnvEntries('TOKEN="abc123"')
    expect(entries).toEqual([['TOKEN', '"abc123"']])
  })
})
