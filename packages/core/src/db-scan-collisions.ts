import type { RepoDbInfo } from './db-scan-fleet.js'

export interface PortCollision {
  port: number
  repos: string[]
}

export interface CredentialCollision {
  user: string
  password: string
  repos: string[]
}

const DEFAULT_POSTGRES_PORT = 5432

export function detectPortCollisions(repos: RepoDbInfo[]): PortCollision[] {
  const byPort = new Map<number, string[]>()
  for (const r of repos) {
    if (r.classification !== 'fixed-port' || r.postgres?.hostPort == null) continue
    const list = byPort.get(r.postgres.hostPort) ?? []
    list.push(r.repo)
    byPort.set(r.postgres.hostPort, list)
  }
  return [...byPort.entries()]
    .filter(([, repoNames]) => repoNames.length > 1)
    .map(([port, repoNames]) => ({ port, repos: repoNames }))
    .sort((a, b) => a.port - b.port)
}

// The precondition for silent cross-project data access: a port collision
// alone just means two containers can't both bind it, but a shared
// user/password pair means the loser's test suite can authenticate against
// the winner's database once it dials the wrong port.
export function detectCredentialCollisions(repos: RepoDbInfo[]): CredentialCollision[] {
  const byCreds = new Map<string, CredentialCollision>()
  for (const r of repos) {
    const user = r.postgres?.user
    const password = r.postgres?.password
    if (!user || !password) continue
    const key = `${user}:${password}`
    const entry = byCreds.get(key) ?? { user, password, repos: [] }
    entry.repos.push(r.repo)
    byCreds.set(key, entry)
  }
  return [...byCreds.values()].filter((entry) => entry.repos.length > 1)
}

export function detectDefaultPortWarnings(repos: RepoDbInfo[]): string[] {
  return repos
    .filter((r) => r.classification === 'fixed-port' && r.postgres?.hostPort === DEFAULT_POSTGRES_PORT)
    .map((r) => r.repo)
}
