import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import {
  scanFleet,
  detectPortCollisions,
  detectCredentialCollisions,
  detectDefaultPortWarnings,
  verifyContainerOwnership,
  type RepoDbInfo,
} from '@emit-infra/core'
import { printInventory, printCollisions, printOwnershipMismatches } from '../lib/db-doctor-report.js'

export async function findOwnershipMismatches(repos: RepoDbInfo[]): Promise<string[]> {
  const mismatches: string[] = []
  for (const r of repos) {
    if (!r.postgres?.containerName) continue
    const result = await verifyContainerOwnership(r.repoPath, r.postgres.containerName)
    if (result === 'mismatch') mismatches.push(r.repo)
  }
  return mismatches
}

export function registerDbDoctor(program: Command): void {
  program
    .command('db-doctor')
    .description('Scan local repos for dev-database port and credential collisions')
    .option(
      '--roots <dir>',
      'Roots directory to scan (each immediate subdirectory is treated as a repo)',
      join(homedir(), 'projects'),
    )
    .action(async (opts: { roots: string }) => {
      const repos = scanFleet(opts.roots)
      const portCollisions = detectPortCollisions(repos)
      const credentialCollisions = detectCredentialCollisions(repos)
      const defaultPortWarnings = detectDefaultPortWarnings(repos)

      console.log(chalk.cyan(`\nScanning ${chalk.bold(opts.roots)} for dev-database configuration...\n`))
      printInventory(repos)
      printCollisions(portCollisions, credentialCollisions, defaultPortWarnings)

      const mismatches = await findOwnershipMismatches(repos)
      printOwnershipMismatches(mismatches)

      const hasIssues = portCollisions.length > 0 || credentialCollisions.length > 0 || defaultPortWarnings.length > 0
      if (hasIssues) process.exit(1)
    })
}
