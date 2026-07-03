import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { alertsRoutes } from './alerts.js'

const { mockFindProject, mockReadFile } = vi.hoisted(() => ({
  mockFindProject: vi.fn(),
  mockReadFile: vi.fn(),
}))

vi.mock('../lib/project-helpers.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/project-helpers.js')>('../lib/project-helpers.js')
  return { ...actual, findProject: mockFindProject }
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, readFile: mockReadFile }
})

function makeApp() {
  const app = Fastify()
  app.register(alertsRoutes)
  return app
}

const FAKE_PROJECT = { config: { name: 'myapp' }, configPath: '/p/myapp', projectDir: '/p' }
const NOW_SEC = 1_750_000_000

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW_SEC * 1000)
})

describe('GET /projects/:name/alerts', () => {
  it('returns 400 for invalid project name', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/bad name/alerts' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for unknown project', async () => {
    mockFindProject.mockResolvedValue(null)
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/alerts' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for invalid days param', async () => {
    mockFindProject.mockResolvedValue(FAKE_PROJECT)
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/alerts?days=999' })
    expect(res.statusCode).toBe(400)
  })

  it('returns empty alerts when file does not exist', async () => {
    mockFindProject.mockResolvedValue(FAKE_PROJECT)
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/alerts' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ alerts: [] })
  })

  it('returns alerts within the requested day range', async () => {
    mockFindProject.mockResolvedValue(FAKE_PROJECT)
    const inRange = { projectName: 'myapp', metric: 'diskPct', op: 'gt', threshold: 80, value: 85, firedAt: NOW_SEC - 3600 }
    const outOfRange = { projectName: 'myapp', metric: 'diskPct', op: 'gt', threshold: 80, value: 85, firedAt: NOW_SEC - 8 * 86400 }
    mockReadFile.mockResolvedValue([inRange, outOfRange].map(a => JSON.stringify(a)).join('\n'))
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/alerts?days=7' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ alerts: [inRange] })
  })

  it('returns all alerts when all are within range', async () => {
    mockFindProject.mockResolvedValue(FAKE_PROJECT)
    const alerts = [
      { metric: 'diskPct', firedAt: NOW_SEC - 1000 },
      { metric: 'memPct', firedAt: NOW_SEC - 2000 },
    ]
    mockReadFile.mockResolvedValue(alerts.map(a => JSON.stringify(a)).join('\n'))
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/alerts?days=7' })
    expect(res.json().alerts).toHaveLength(2)
  })

  it('defaults to 7 days when no days param given', async () => {
    mockFindProject.mockResolvedValue(FAKE_PROJECT)
    const alert = { metric: 'diskPct', firedAt: NOW_SEC - 6 * 86400 }
    mockReadFile.mockResolvedValue(JSON.stringify(alert))
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/alerts' })
    expect(res.json().alerts).toHaveLength(1)
  })
})
