import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, scanRepo, scanFleet } from './db-scan-fleet.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'db-scan.fixtures')

const tmpDirs: string[] = []

function makeRoots(repos: Record<string, Record<string, string>>): string {
  const roots = mkdtempSync(join(tmpdir(), 'db-scan-fleet-test-'))
  tmpDirs.push(roots)
  for (const [repoName, files] of Object.entries(repos)) {
    for (const [relative, fixtureName] of Object.entries(files)) {
      const dest = join(roots, repoName, relative)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, readFileSync(join(FIXTURES_DIR, fixtureName), 'utf-8'))
    }
  }
  return roots
}

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

describe('classify', () => {
  it('classifies no postgres info as no-database', () => {
    expect(classify(null)).toBe('no-database')
  })

  it('classifies an ephemeral service as ephemeral', () => {
    expect(classify({
      serviceName: 'postgres', containerName: null, hostPort: null, isEphemeral: true,
      user: 'a', password: 'a', database: 'a',
    })).toBe('ephemeral')
  })

  it('classifies a fixed host port as fixed-port', () => {
    expect(classify({
      serviceName: 'postgres', containerName: null, hostPort: 5432, isEphemeral: false,
      user: 'a', password: 'a', database: 'a',
    })).toBe('fixed-port')
  })
})

describe('scanRepo', () => {
  it('reports the repo name from the directory, not the compose service', () => {
    const roots = makeRoots({ 'my-repo': { 'docker-compose.yml': 'ephemeral.docker-compose.yml' } })
    const result = scanRepo(join(roots, 'my-repo'))
    expect(result.repo).toBe('my-repo')
    expect(result.classification).toBe('ephemeral')
  })
})

describe('scanFleet', () => {
  it('scans every immediate subdirectory and classifies each', () => {
    const roots = makeRoots({
      'proj-ephemeral': { 'docker-compose.yml': 'ephemeral.docker-compose.yml' },
      'proj-fixed': { 'compose.yaml': 'fixed-interpolated.compose.yaml' },
      'proj-nested': { 'docker/docker-compose.yml': 'nested.docker-compose.yml' },
      'proj-no-db': { 'docker-compose.yml': 'no-database.docker-compose.yml' },
    })

    const results = scanFleet(roots)
    const byRepo = Object.fromEntries(results.map((r) => [r.repo, r]))

    expect(results).toHaveLength(4)
    expect(byRepo['proj-ephemeral']?.classification).toBe('ephemeral')
    expect(byRepo['proj-fixed']?.classification).toBe('fixed-port')
    expect(byRepo['proj-fixed']?.postgres?.hostPort).toBe(5440)
    expect(byRepo['proj-nested']?.composeFile).toBe(join('docker', 'docker-compose.yml'))
    expect(byRepo['proj-no-db']?.classification).toBe('no-database')
  })

  it('skips dotfiles and node_modules directories', () => {
    const roots = makeRoots({ 'proj-a': { 'docker-compose.yml': 'ephemeral.docker-compose.yml' } })
    mkdirSync(join(roots, '.hidden'))
    mkdirSync(join(roots, 'node_modules'))

    const results = scanFleet(roots)
    expect(results.map((r) => r.repo)).toEqual(['proj-a'])
  })

  it('returns an empty array for a roots directory that does not exist', () => {
    expect(scanFleet('/nonexistent/roots/dir/for/db-scan-test')).toEqual([])
  })
})
