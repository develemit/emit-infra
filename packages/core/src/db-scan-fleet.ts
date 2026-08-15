import { readdirSync, type Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { parseRepoCompose, type PostgresServiceInfo } from './db-scan-compose.js'

export type DbClassification = 'ephemeral' | 'fixed-port' | 'no-database'

export interface RepoDbInfo {
  repo: string
  repoPath: string
  composeFile: string | null
  postgres: PostgresServiceInfo | null
  classification: DbClassification
}

export function classify(postgres: PostgresServiceInfo | null): DbClassification {
  if (!postgres) return 'no-database'
  return postgres.isEphemeral ? 'ephemeral' : 'fixed-port'
}

export function scanRepo(repoPath: string): RepoDbInfo {
  const { composeFile, postgres } = parseRepoCompose(repoPath)
  return {
    repo: basename(repoPath),
    repoPath,
    composeFile,
    postgres,
    classification: classify(postgres),
  }
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

/** Scans one level of `rootsDir` — every immediate subdirectory is treated as a repo. */
export function scanFleet(rootsDir: string): RepoDbInfo[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(rootsDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => scanRepo(join(rootsDir, e.name)))
}
