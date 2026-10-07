export type DumpFormat = 'custom' | 'sql-gz'

export interface ListedObject {
  key: string
  bytes: number
}

export interface TableRows {
  table: string
  rows: number
}

export const RESTORE_DB = 'drill'
export const RESTORE_USER = 'postgres'

const BACKUP_SUFFIXES = ['.dump', '.sql.gz']

/** Parses `aws s3 ls` output; `prefix` is prepended because `ls` prints keys relative to it. */
export function parseS3Listing(output: string, prefix: string): ListedObject[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 4 && /^\d+$/.test(parts[2] ?? ''))
    .map((parts) => ({ key: `${prefix}${parts.slice(3).join(' ')}`, bytes: Number(parts[2]) }))
}

/** Keys embed a sortable UTC timestamp, so lexicographic order is chronological within one prefix. */
export function newestBackup(objects: ListedObject[], prefix: string): ListedObject | null {
  const candidates = objects
    .filter((o) => o.key.startsWith(prefix) && !o.key.slice(prefix.length).includes('/'))
    .filter((o) => BACKUP_SUFFIXES.some((s) => o.key.endsWith(s)))
    .sort((a, b) => a.key.localeCompare(b.key))
  return candidates.at(-1) ?? null
}

export function detectFormat(key: string): DumpFormat {
  if (key.endsWith('.sql.gz')) return 'sql-gz'
  if (key.endsWith('.dump')) return 'custom'
  throw new Error(`unrecognised backup format: ${key}`)
}

/** Reads the dump from stdin; run via `docker exec -i <container> <argv>`. */
export function buildRestoreArgv(format: DumpFormat): string[] {
  if (format === 'custom') {
    return ['pg_restore', '--no-owner', '--no-acl', '-U', RESTORE_USER, '-d', RESTORE_DB]
  }
  return [
    'sh',
    '-c',
    `gunzip | psql -v ON_ERROR_STOP=1 -q -U ${RESTORE_USER} -d ${RESTORE_DB} >/dev/null`,
  ]
}

export function buildPsqlArgv(sql: string): string[] {
  return ['psql', '-At', '-F', '|', '-U', RESTORE_USER, '-d', RESTORE_DB, '-c', sql]
}

export const USER_TABLE_COUNT_SQL =
  "select count(*) from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog','information_schema')"

/** `ANALYZE` first so n_live_tup is populated on a freshly restored database. */
export const ANALYZE_SQL = 'analyze'

export const TOP_TABLES_SQL =
  "select schemaname || '.' || relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc, relname limit 5"

export function parseTableCount(output: string): number {
  const n = Number(output.trim())
  if (!Number.isInteger(n) || n < 0) throw new Error(`unexpected table count output: ${output.trim()}`)
  return n
}

export function parseTopTables(output: string): TableRows[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.lastIndexOf('|')
      return { table: line.slice(0, idx), rows: Number(line.slice(idx + 1)) }
    })
    .filter((t) => t.table !== '' && Number.isFinite(t.rows))
}

/** A verify query passes when psql printed at least one row. */
export function hasRows(output: string): boolean {
  return output.trim() !== ''
}

const ROLE_REF_RE = /\b(?:OWNER TO|GRANT [^;]*? TO|ALTER DEFAULT PRIVILEGES FOR ROLE) ("[^"]+"|[A-Za-z_][\w$-]*)/g
const BUILTIN_ROLES = new Set(['public', 'postgres', 'current_user', 'session_user', 'current_role'])

/**
 * Plain-SQL dumps made without --no-owner reference the app's roles; a restore
 * with ON_ERROR_STOP dies on the first one unless they exist.
 */
export function parseDumpRoles(sql: string): string[] {
  const roles = new Set<string>()
  for (const m of sql.matchAll(ROLE_REF_RE)) {
    const role = (m[1] ?? '').replace(/^"|"$/g, '')
    if (role && !BUILTIN_ROLES.has(role.toLowerCase())) roles.add(role)
  }
  return [...roles].sort()
}

export function buildCreateRoleSql(role: string): string {
  return `create role "${role.replace(/"/g, '""')}"`
}

/** A plain dump from pg_dump N can use settings only server N or newer knows (e.g. transaction_timeout in 17). */
export function parseDumpMajor(sql: string): number | null {
  const majors = [...sql.slice(0, 4096).matchAll(/-- Dumped (?:from database|by pg_dump) version (\d+)/g)].map((m) => Number(m[1]))
  return majors.length ? Math.max(...majors) : null
}
