import { describe, it, expect } from 'vitest'
import {
  buildCreateRoleSql,
  buildPsqlArgv,
  buildRestoreArgv,
  detectFormat,
  hasRows,
  newestBackup,
  parseDumpMajor,
  parseDumpRoles,
  parseS3Listing,
  parseTableCount,
  parseTopTables,
} from './backup-verify.js'

const LISTING = `2026-10-05 17:38:19   18760811 diner-decider_20261006_003816.sql.gz
2026-10-06 16:05:16   18909213 diner-decider_20261006_230513.sql.gz
2026-10-06 16:05:17        120 notes.txt
                           PRE sub/`

describe('parseS3Listing', () => {
  it('prepends the prefix and skips PRE lines', () => {
    expect(parseS3Listing(LISTING, 'db-backups/').map((o) => o.key)).toEqual([
      'db-backups/diner-decider_20261006_003816.sql.gz',
      'db-backups/diner-decider_20261006_230513.sql.gz',
      'db-backups/notes.txt',
    ])
  })
})

describe('newestBackup', () => {
  it('picks the latest timestamped dump and ignores other prefixes and non-dumps', () => {
    const objs = [
      { key: 'db-backups/a_20261006_003816.sql.gz', bytes: 1 },
      { key: 'db-backups/a_20261006_230513.sql.gz', bytes: 2 },
      { key: 'db-backups/notes.txt', bytes: 3 },
      { key: 'pre-deploy/a_20270101_000000.sql.gz', bytes: 4 },
      { key: 'db-backups/nested/a_20280101_000000.sql.gz', bytes: 5 },
    ]
    expect(newestBackup(objs, 'db-backups/')?.bytes).toBe(2)
  })

  it('returns null when nothing matches', () => {
    expect(newestBackup([{ key: 'other/x.dump', bytes: 1 }], 'db-backups/')).toBeNull()
  })
})

describe('detectFormat', () => {
  it('recognises both fleet formats', () => {
    expect(detectFormat('db-backups/x.dump')).toBe('custom')
    expect(detectFormat('pg/x.sql.gz')).toBe('sql-gz')
  })

  it('rejects anything else', () => {
    expect(() => detectFormat('x.tar')).toThrow(/unrecognised/)
  })
})

describe('buildRestoreArgv', () => {
  it('uses pg_restore for custom dumps', () => {
    const argv = buildRestoreArgv('custom')
    expect(argv.slice(0, 3)).toEqual(['pg_restore', '--no-owner', '--no-acl'])
  })

  it('pipes gunzip into psql with ON_ERROR_STOP for sql.gz', () => {
    const argv = buildRestoreArgv('sql-gz')
    expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
    expect(argv[2]).toMatch(/gunzip \| psql -v ON_ERROR_STOP=1/)
  })
})

describe('buildPsqlArgv', () => {
  it('runs a single tuples-only query', () => {
    expect(buildPsqlArgv('select 1')).toContain('-At')
    expect(buildPsqlArgv('select 1').at(-1)).toBe('select 1')
  })
})

describe('output parsing', () => {
  it('parses the table count', () => {
    expect(parseTableCount('37\n')).toBe(37)
    expect(() => parseTableCount('oops')).toThrow()
  })

  it('parses table|rows lines', () => {
    expect(parseTopTables('public.a|10\npublic.b|2\n\n')).toEqual([
      { table: 'public.a', rows: 10 },
      { table: 'public.b', rows: 2 },
    ])
  })

  it('treats empty psql output as no rows', () => {
    expect(hasRows('')).toBe(false)
    expect(hasRows('1\n')).toBe(true)
  })
})

describe('dump header and roles', () => {
  it('reads the newest pg_dump major from the header', () => {
    const sql = '-- Dumped from database version 16.4\n-- Dumped by pg_dump version 17.2\n'
    expect(parseDumpMajor(sql)).toBe(17)
    expect(parseDumpMajor('select 1')).toBeNull()
  })

  it('collects app roles but not built-ins', () => {
    const sql = `ALTER TABLE public.a OWNER TO diner;
GRANT ALL ON SCHEMA public TO PUBLIC;
GRANT SELECT ON TABLE public.a TO "easy-living";
ALTER TABLE public.b OWNER TO postgres;`
    expect(parseDumpRoles(sql)).toEqual(['diner', 'easy-living'])
  })

  it('quotes role names', () => {
    expect(buildCreateRoleSql('a"b')).toBe('create role "a""b"')
  })
})
