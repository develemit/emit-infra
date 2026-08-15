import type { Pool } from 'pg'

const READY_TIMEOUT_MS = 15_000
const READY_POLL_MS = 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// `pg` is loaded lazily so a plain `db-url` call (the hot-path case — no
// connection needed, just a URL string) never pays for importing it.
export async function createPool(connectionString: string): Promise<Pool> {
  const { Pool: PgPool } = await import('pg')
  return new PgPool({ connectionString })
}

// A minimal shape rather than `Pick<Pool, 'query'>` — Pool's real `query` is
// heavily overloaded, and matching every overload is more than callers (real
// or test doubles) should have to satisfy just to pass a plain "run this SQL"
// function through.
export interface Queryable {
  query(sql: string): Promise<{ rows: unknown[] }>
}

/**
 * Postgres isn't instantly ready after `docker compose up`; poll a trivial
 * query until it accepts connections instead of surfacing a misleading
 * connection-refused error from whatever runs immediately after.
 */
export async function waitUntilReady(
  pool: Queryable,
  timeoutMs = READY_TIMEOUT_MS,
  pollMs = READY_POLL_MS,
): Promise<void> {
  const start = Date.now()
  let lastError: unknown
  while (Date.now() - start < timeoutMs) {
    try {
      await pool.query('select 1')
      return
    } catch (err) {
      lastError = err
      await sleep(pollMs)
    }
  }
  throw new Error(
    `Postgres was not ready within ${timeoutMs}ms: ${(lastError as Error)?.message ?? 'unknown error'}`,
    { cause: lastError },
  )
}

export async function fetchCurrentDatabase(pool: Queryable): Promise<string | null> {
  const result = await pool.query('select current_database() as name')
  return (result.rows[0] as { name?: string } | undefined)?.name ?? null
}

/**
 * The highest-value half of the resolver: converts "silently ran against the
 * wrong database" (e.g. a stale DATABASE_URL left over from another repo)
 * into an immediate, obvious failure naming both what was found and expected.
 */
export function assertDatabaseIdentity(found: string | null, expected: string): void {
  if (found !== expected) {
    throw new Error(
      `Refusing to proceed: connected to database "${found ?? '(none)'}", expected "${expected}".`,
    )
  }
}
