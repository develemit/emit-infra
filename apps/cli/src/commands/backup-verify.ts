import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { execa } from 'execa'
import {
  RESTORE_DB,
  RESTORE_USER,
  ANALYZE_SQL,
  TOP_TABLES_SQL,
  USER_TABLE_COUNT_SQL,
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
  type ListedObject,
  type TableRows,
} from '../lib/backup-verify.js'
import type { BackupCreds } from '../lib/backup-creds.js'

export interface DrillInput {
  name: string
  creds: BackupCreds
  prefixes: string[]
  verifyQueries: string[]
  /** Image major to force; otherwise taken from the dump header, falling back to DEFAULT_PG_MAJOR. */
  pgMajor?: string
}

export interface DrillResult {
  t: string
  key: string
  bytes: number
  durationSec: number
  tables: number
  topTables: TableRows[]
  ok: boolean
  error?: string
}

const READY_ATTEMPTS = 60
const DEFAULT_PG_MAJOR = '16'

function awsEnv(c: BackupCreds): Record<string, string> {
  return { AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey, AWS_DEFAULT_REGION: 'auto' }
}

async function findNewest(input: DrillInput): Promise<ListedObject> {
  const { creds } = input
  for (const prefix of input.prefixes) {
    // `aws s3 ls` exits 1 with empty stderr when the prefix has no objects; that just means try the next prefix.
    const { stdout, stderr, exitCode } = await execa('aws', ['s3', 'ls', `s3://${creds.bucket}/${prefix}`, '--endpoint-url', creds.endpoint], {
      env: awsEnv(creds),
      reject: false,
    })
    if (exitCode !== 0 && stderr.trim()) throw new Error(`aws s3 ls failed: ${stderr.trim()}`)
    const newest = newestBackup(parseS3Listing(stdout, prefix), prefix)
    if (newest) return newest
  }
  throw new Error(`no .dump or .sql.gz under ${input.prefixes.join(', ')} in bucket ${creds.bucket}`)
}

async function waitForPostgres(container: string): Promise<void> {
  // The image's init phase runs a socket-only server first, so only a TCP probe means the real one is up.
  for (let i = 0; i < READY_ATTEMPTS; i++) {
    const r = await execa('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', RESTORE_USER], { reject: false })
    if (r.exitCode === 0) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('throwaway postgres never became ready')
}

const psql = async (container: string, sql: string): Promise<string> =>
  (await execa('docker', ['exec', container, ...buildPsqlArgv(sql)])).stdout

async function createDumpRoles(container: string, sql: string): Promise<void> {
  for (const role of parseDumpRoles(sql)) await psql(container, buildCreateRoleSql(role))
}

async function runChecks(container: string, verifyQueries: string[]): Promise<{ tables: number; topTables: TableRows[] }> {
  const tables = parseTableCount(await psql(container, USER_TABLE_COUNT_SQL))
  if (tables === 0) throw new Error('restore produced no user tables')
  await psql(container, ANALYZE_SQL)
  const topTables = parseTopTables(await psql(container, TOP_TABLES_SQL))
  for (const q of verifyQueries) {
    if (!hasRows(await psql(container, q))) throw new Error(`verify query returned no rows: ${q}`)
  }
  return { tables, topTables }
}

export async function runDrill(input: DrillInput): Promise<DrillResult> {
  const started = Date.now()
  const base = { t: new Date().toISOString(), key: '', bytes: 0, tables: 0, topTables: [] as TableRows[] }
  let workDir: string | null = null
  let container: string | null = null
  const removeContainer = async (): Promise<void> => {
    if (container) await execa('docker', ['rm', '-f', container], { reject: false })
  }
  const onSigint = (): void => {
    void removeContainer().finally(() => process.exit(130))
  }
  process.once('SIGINT', onSigint)

  try {
    const newest = await findNewest(input)
    base.key = newest.key
    workDir = await mkdtemp(join(tmpdir(), 'backup-verify-'))
    const local = join(workDir, basename(newest.key))
    await execa('aws', ['s3', 'cp', `s3://${input.creds.bucket}/${newest.key}`, local, '--endpoint-url', input.creds.endpoint], {
      env: awsEnv(input.creds),
    })
    base.bytes = (await stat(local)).size

    const format = detectFormat(newest.key)
    const sql = format === 'sql-gz' ? gunzipSync(await readFile(local)).toString('utf-8') : null
    const major = input.pgMajor ?? String((sql && parseDumpMajor(sql)) || DEFAULT_PG_MAJOR)
    const run = await execa('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=drill', `postgres:${major}-alpine`])
    container = run.stdout.trim()
    await waitForPostgres(container)
    await execa('docker', ['exec', container, 'createdb', '-U', RESTORE_USER, RESTORE_DB])
    if (sql) await createDumpRoles(container, sql)
    await execa('docker', ['exec', '-i', container, ...buildRestoreArgv(format)], { inputFile: local })

    const checks = await runChecks(container, input.verifyQueries)
    return { ...base, ...checks, durationSec: Math.round((Date.now() - started) / 1000), ok: true }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ...base, durationSec: Math.round((Date.now() - started) / 1000), ok: false, error: detail.slice(0, 2000) }
  } finally {
    process.removeListener('SIGINT', onSigint)
    await removeContainer()
    if (workDir) await rm(workDir, { recursive: true, force: true })
  }
}
