import { dirname, join } from 'node:path'

import { Command } from 'commander'
import {
  parseRepoComposeService,
  resolveHostPort,
  buildDatabaseUrl,
  createPool,
  waitUntilReady,
  fetchCurrentDatabase,
  assertDatabaseIdentity,
} from '@emit-infra/core'

interface DbUrlOptions {
  service: string
  assertIdentity?: boolean
}

// Exported so the identity-assertion path can be unit-tested without wiring
// up commander. Errors propagate to the caller — nothing is written to
// stdout until the URL is fully resolved and (if requested) verified.
export async function resolveDbUrl(cwd: string, opts: DbUrlOptions): Promise<string> {
  const { composeFile, postgres } = parseRepoComposeService(cwd, opts.service)
  if (!composeFile) throw new Error(`No docker-compose file found in ${cwd}`)
  if (!postgres) throw new Error(`No "${opts.service}" service found in ${composeFile}`)

  // `docker compose` only looks for a compose file in its own cwd — repos
  // that keep theirs in a subdirectory (martialops: `docker/`) need `docker
  // compose port` invoked from that subdirectory, not the repo root.
  const composeDir = join(cwd, dirname(composeFile))
  const hostPort = await resolveHostPort(composeDir, opts.service)
  const url = buildDatabaseUrl(postgres, hostPort)

  if (opts.assertIdentity) {
    const pool = await createPool(url)
    try {
      await waitUntilReady(pool)
      const found = await fetchCurrentDatabase(pool)
      assertDatabaseIdentity(found, postgres.database as string)
    } finally {
      await pool.end()
    }
  }

  return url
}

export function registerDbUrl(program: Command): void {
  program
    .command('db-url')
    .description(
      'Print the dev Postgres URL for this repo, resolved via docker compose — stdout carries only the URL',
    )
    .option('--service <name>', 'docker-compose service name', 'postgres')
    .option(
      '--assert-identity',
      'connect and verify the URL points at the expected database (per POSTGRES_DB)',
    )
    .action(async (opts: DbUrlOptions) => {
      try {
        const url = await resolveDbUrl(process.cwd(), opts)
        process.stdout.write(`${url}\n`)
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      }
    })
}
