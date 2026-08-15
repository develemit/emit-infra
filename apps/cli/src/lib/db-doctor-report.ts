import chalk from 'chalk'
import type { RepoDbInfo, PortCollision, CredentialCollision } from '@emit-infra/core'

function classificationColor(c: RepoDbInfo['classification']): (s: string) => string {
  if (c === 'ephemeral') return chalk.green
  if (c === 'fixed-port') return chalk.yellow
  return chalk.dim
}

// Plain padEnd() lets an overlong cell (e.g. a long user/password pair) run
// straight into the next column with no gap — always force at least a
// two-space separator instead.
function col(text: string, width: number): string {
  return text.length >= width ? text + '  ' : text.padEnd(width)
}

export function printInventory(repos: RepoDbInfo[]): void {
  const withDb = repos.filter((r) => r.classification !== 'no-database')
  if (withDb.length === 0) {
    console.log(chalk.dim('No repos with a Postgres compose service found.\n'))
    return
  }

  const header = col('Repo', 24) + col('Port', 11) + col('User/Pass', 24) + col('Database', 18) + 'Compose file'
  console.log(chalk.bold(header))

  for (const r of withDb) {
    const port = r.classification === 'ephemeral' ? 'ephemeral' : String(r.postgres?.hostPort ?? '?')
    const creds = r.postgres?.user && r.postgres?.password ? `${r.postgres.user}/${r.postgres.password}` : '?'
    const color = classificationColor(r.classification)
    console.log(
      col(r.repo, 24) +
      color(col(port, 11)) +
      col(creds, 24) +
      col(r.postgres?.database ?? '?', 18) +
      (r.composeFile ?? '?'),
    )
  }

  const noDb = repos.length - withDb.length
  if (noDb > 0) console.log(chalk.dim(`\n${noDb} repo${noDb === 1 ? '' : 's'} with no database.`))
  console.log()
}

export function printCollisions(
  portCollisions: PortCollision[],
  credentialCollisions: CredentialCollision[],
  defaultPortWarnings: string[],
): void {
  if (portCollisions.length === 0 && credentialCollisions.length === 0 && defaultPortWarnings.length === 0) {
    console.log(chalk.green('No port or credential collisions found.\n'))
    return
  }

  for (const c of portCollisions) {
    console.log(chalk.red(`✖ Port ${c.port} is claimed by ${c.repos.length} repos: ${c.repos.join(', ')}`))
  }
  for (const c of credentialCollisions) {
    console.log(chalk.red(`✖ Credentials ${c.user}/${c.password} are shared by: ${c.repos.join(', ')} — the losing repo's test suite can authenticate into the winner's database`))
  }
  for (const repo of defaultPortWarnings) {
    console.log(chalk.yellow(`⚠ ${repo} runs Postgres on the default port 5432 — highest risk for an accidental cross-project connection`))
  }
  console.log()
}

export function printOwnershipMismatches(mismatches: string[]): void {
  if (mismatches.length === 0) return
  console.log(chalk.red.bold('Ownership mismatches (running container does not belong to the repo its compose file suggests):'))
  for (const repo of mismatches) {
    console.log(chalk.red(`✖ ${repo} — container's working_dir label points elsewhere; do not trust this repo's declared port right now`))
  }
  console.log()
}
