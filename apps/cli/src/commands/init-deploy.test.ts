import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { detectServices, detectHealthPaths } from '../lib/detect-project.js'

describe('detectServices', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'init-deploy-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects services from docker-compose.yml', () => {
    writeFileSync(
      join(dir, 'docker-compose.yml'),
      `services:
  api:
    build: .
    ports:
      - "3001:3001"
  web:
    build: .
    ports:
      - "3000:3000"
  postgres:
    image: postgres:16
`,
    )

    const services = detectServices(dir)
    expect(services.map((s) => s.name)).toEqual(['api', 'web'])
    expect(services.find((s) => s.name === 'api')?.internalPort).toBe(3001)
  })

  it('detects services from apps/ directory with Dockerfiles', () => {
    const appsDir = join(dir, 'apps')
    mkdirSync(join(appsDir, 'api'), { recursive: true })
    mkdirSync(join(appsDir, 'web'), { recursive: true })
    mkdirSync(join(appsDir, 'docs'), { recursive: true })

    writeFileSync(join(appsDir, 'api', 'Dockerfile'), 'FROM node:20')
    writeFileSync(join(appsDir, 'web', 'Dockerfile'), 'FROM node:20')

    const services = detectServices(dir)
    expect(services.map((s) => s.name).sort()).toEqual(['api', 'web'])
  })

  it('falls back to single "app" service when nothing detected', () => {
    const services = detectServices(dir)
    expect(services).toEqual([{ name: 'app' }])
  })

  it('filters out infra services', () => {
    writeFileSync(
      join(dir, 'docker-compose.yml'),
      `services:
  api:
    build: .
  redis:
    image: redis:7
  clickhouse:
    image: clickhouse/clickhouse-server
`,
    )

    const services = detectServices(dir)
    expect(services.map((s) => s.name)).toEqual(['api'])
  })
})

describe('detectHealthPaths', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'health-detect-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects /healthz from source files', () => {
    const apiDir = join(dir, 'apps', 'api', 'src')
    mkdirSync(apiDir, { recursive: true })
    writeFileSync(join(apiDir, 'routes.ts'), `app.get('/healthz', (req, res) => res.send('ok'))`)

    const paths = detectHealthPaths(dir)
    expect(paths['api']).toBe('/healthz')
  })

  it('detects /health from source files', () => {
    const apiDir = join(dir, 'apps', 'api', 'src')
    mkdirSync(apiDir, { recursive: true })
    writeFileSync(join(apiDir, 'index.ts'), `router.get("/health", handler)`)

    const paths = detectHealthPaths(dir)
    expect(paths['api']).toBe('/health')
  })
})

describe('init-deploy config generation', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'init-deploy-gen-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates blueGreen config in .emit-infra.json', async () => {
    writeFileSync(
      join(dir, '.emit-infra.json'),
      JSON.stringify({
        name: 'test-project',
        domain: 'test.com',
        region: 'nbg1',
        serverType: 'cx22',
        sshKeyName: 'emit-deploy',
        github: { repo: 'user/test' },
      }),
    )

    const appsDir = join(dir, 'apps')
    mkdirSync(join(appsDir, 'api'), { recursive: true })
    mkdirSync(join(appsDir, 'web'), { recursive: true })
    writeFileSync(join(appsDir, 'api', 'Dockerfile'), 'FROM node:20')
    writeFileSync(join(appsDir, 'web', 'Dockerfile'), 'FROM node:20')

    const { execaSync } = await import('execa')
    const result = execaSync('npx', ['tsx', join(__dirname, '..', 'index.ts'), 'init-deploy', '--port-base', '4000', '-y'], {
      cwd: dir,
      env: { ...process.env, NODE_ENV: 'test' },
      reject: false,
    })

    const config = JSON.parse(readFileSync(join(dir, '.emit-infra.json'), 'utf-8'))
    expect(config.blueGreen).toBeDefined()
    expect(config.blueGreen.services).toHaveLength(2)
    expect(config.name).toBe('test-project')
  })
})
