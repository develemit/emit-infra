import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auditDockerfile, auditDockerignore, parseSizeMb } from './audit-checks.js'

describe('audit-checks', () => {
  describe('auditDockerfile', () => {
    it('flags dev server in CMD', () => {
      const content = `FROM node:20
RUN npm install
CMD ["npm", "run", "dev"]
`
      const issues = auditDockerfile('/path/Dockerfile', content)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.some(i => i.message.includes('dev server'))).toBe(true)
    })

    it('flags single-stage build', () => {
      const content = `FROM node:20
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "start"]
`
      const issues = auditDockerfile('/path/Dockerfile', content)
      expect(issues.some(i => i.message.includes('Single-stage'))).toBe(true)
    })

    it('flags pnpm install without --frozen-lockfile', () => {
      const content = `FROM node:20 AS builder
RUN pnpm install
FROM node:20
COPY --from=builder . .
CMD ["npm", "start"]
`
      const issues = auditDockerfile('/path/Dockerfile', content)
      expect(issues.some(i => i.message.includes('--frozen-lockfile'))).toBe(true)
    })

    it('accepts multi-stage with frozen-lockfile', () => {
      const content = `FROM node:20 AS builder
RUN pnpm install --frozen-lockfile
FROM node:20
COPY --from=builder . .
CMD ["npm", "start"]
`
      const issues = auditDockerfile('/path/Dockerfile', content)
      expect(issues.some(i => i.message.includes('--frozen-lockfile'))).toBe(false)
    })
  })

  describe('auditDockerignore', () => {
    beforeEach(() => {
      vi.unmock('node:fs')
    })

    it('flags missing .dockerignore', () => {
      vi.mock('node:fs', () => ({
        existsSync: () => false,
        readFileSync: vi.fn(),
        readdirSync: vi.fn(),
      }))
      const issues = auditDockerignore('/path')
      expect(issues.some(i => i.message.includes('No .dockerignore'))).toBe(true)
    })
  })

  describe('parseSizeMb', () => {
    it('parses GB correctly', () => {
      expect(parseSizeMb('1.5 GB')).toBe(1536)
    })

    it('parses MB correctly', () => {
      expect(parseSizeMb('500 MB')).toBe(500)
    })

    it('parses kB correctly', () => {
      expect(parseSizeMb('1024 kB')).toBe(1)
    })

    it('returns 0 for invalid input', () => {
      expect(parseSizeMb('invalid')).toBe(0)
    })
  })
})
