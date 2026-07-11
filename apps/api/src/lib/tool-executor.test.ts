import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SseEvent } from './write-sse.js'

vi.mock('./discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('./stream-process.js', () => ({
  streamProcess: vi.fn().mockImplementation(async function* () {
    yield { type: 'done' as const, exitCode: 0 }
  }),
}))

import { executeTool } from './tool-executor.js'
import { discoverProjects } from './discover-projects.js'
import { streamProcess } from './stream-process.js'

const mockDiscoverProjects = vi.mocked(discoverProjects)
const mockStreamProcess = vi.mocked(streamProcess)

const mockProject = {
  config: {
    name: 'test-project',
    domain: 'test.example.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    serverIp: '192.168.1.1',
    github: { repo: 'user/test-project' },
  },
  configPath: '/home/user/projects/test-project/.emit-infra.json',
  projectDir: '/home/user/projects/test-project',
}

describe('executeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDiscoverProjects.mockResolvedValue([mockProject])
  })

  describe('get_logs with service validation', () => {
    it('rejects malicious service name with shell command injection', async () => {
      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: 'web; rm -rf /',
      })

      expect(result).toEqual({ error: 'invalid service name' })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('rejects malicious service name with command substitution', async () => {
      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: '$(reboot)',
      })

      expect(result).toEqual({ error: 'invalid service name' })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('rejects malicious service name with backtick execution', async () => {
      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: '`whoami`',
      })

      expect(result).toEqual({ error: 'invalid service name' })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('rejects service name with quotes', async () => {
      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: "web'; DROP TABLE logs; --",
      })

      expect(result).toEqual({ error: 'invalid service name' })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('allows valid service name with alphanumerics and safe characters', async () => {
      mockStreamProcess.mockImplementationOnce(async function* () {
        yield { type: 'line', stream: 'stdout', text: 'log line 1' } as SseEvent
        yield { type: 'done', exitCode: 0 } as SseEvent
      })

      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: 'web',
      })

      expect(result).toEqual({ logs: 'log line 1' })
      expect(mockStreamProcess).toHaveBeenCalled()
    })

    it('allows valid service name with underscores and hyphens', async () => {
      mockStreamProcess.mockImplementationOnce(async function* () {
        yield { type: 'line', stream: 'stdout', text: 'log output' } as SseEvent
        yield { type: 'done', exitCode: 0 } as SseEvent
      })

      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: 'my_service-app',
      })

      expect(result).toEqual({ logs: 'log output' })
      expect(mockStreamProcess).toHaveBeenCalled()
    })

    it('allows valid service name with dots', async () => {
      mockStreamProcess.mockImplementationOnce(async function* () {
        yield { type: 'line', stream: 'stdout', text: 'output' } as SseEvent
        yield { type: 'done', exitCode: 0 } as SseEvent
      })

      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: 'db.primary',
      })

      expect(result).toEqual({ logs: 'output' })
      expect(mockStreamProcess).toHaveBeenCalled()
    })

    it('allows empty service name (means all services)', async () => {
      mockStreamProcess.mockImplementationOnce(async function* () {
        yield { type: 'line', stream: 'stdout', text: 'all logs' } as SseEvent
        yield { type: 'done', exitCode: 0 } as SseEvent
      })

      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: '',
      })

      expect(result).toEqual({ logs: 'all logs' })
      expect(mockStreamProcess).toHaveBeenCalled()
    })

    it('allows undefined service name (means all services)', async () => {
      mockStreamProcess.mockImplementationOnce(async function* () {
        yield { type: 'line', stream: 'stdout', text: 'all logs' } as SseEvent
        yield { type: 'done', exitCode: 0 } as SseEvent
      })

      const result = await executeTool('get_logs', {
        name: 'test-project',
      })

      expect(result).toEqual({ logs: 'all logs' })
      expect(mockStreamProcess).toHaveBeenCalled()
    })

    it('rejects service name starting with non-alphanumeric', async () => {
      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: '_invalid',
      })

      expect(result).toEqual({ error: 'invalid service name' })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('rejects service name with special characters', async () => {
      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: 'web@host',
      })

      expect(result).toEqual({ error: 'invalid service name' })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('passes valid service to collectLogs for ssh interpolation', async () => {
      mockStreamProcess.mockImplementationOnce(async function* () {
        yield { type: 'line', stream: 'stdout', text: 'service-specific log' } as SseEvent
        yield { type: 'done', exitCode: 0 } as SseEvent
      })

      const result = await executeTool('get_logs', {
        name: 'test-project',
        service: 'web',
      })

      expect(result).toEqual({ logs: 'service-specific log' })
      // Verify streamProcess was called (which means collectLogs ran and SSH was invoked)
      const callArgs = mockStreamProcess.mock.calls[0]
      expect(callArgs).toBeDefined()
      if (callArgs) {
        expect(callArgs[0]).toBe('ssh')
        // The args include the docker compose command with the service
        expect(callArgs[1].some(arg => arg.includes('web'))).toBe(true)
      }
    })
  })

  describe('destructive tools', () => {
    it('deploy returns requiresConfirmation without executing', async () => {
      const result = await executeTool('deploy', {
        name: 'test-project',
      })

      expect(result).toEqual({
        requiresConfirmation: true,
        toolName: 'deploy',
        projectName: 'test-project',
      })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('provision returns requiresConfirmation without executing', async () => {
      const result = await executeTool('provision', {
        name: 'test-project',
      })

      expect(result).toEqual({
        requiresConfirmation: true,
        toolName: 'provision',
        projectName: 'test-project',
      })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })

    it('destroy returns requiresConfirmation without executing', async () => {
      const result = await executeTool('destroy', {
        name: 'test-project',
      })

      expect(result).toEqual({
        requiresConfirmation: true,
        toolName: 'destroy',
        projectName: 'test-project',
      })
      expect(mockStreamProcess).not.toHaveBeenCalled()
    })
  })
})
