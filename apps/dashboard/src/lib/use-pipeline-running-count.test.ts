import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePipelineRunningCount } from './use-pipeline-running-count'
import * as api from './api'
import type { ProjectSummary } from './api-projects'
import type { CiStatus, DeployStatus } from './api-containers'

vi.mock('./api')

function project(name: string): ProjectSummary {
  return {
    config: { name } as ProjectSummary['config'],
    configPath: `/tmp/${name}.json`,
    projectDir: `/tmp/${name}`,
  }
}

function running(): CiStatus {
  return { status: 'running', runState: { state: 'running', reason: 'x', heartbeatAgeSec: 1, pidAlive: true, sameHost: true } }
}

function orphaned(): CiStatus {
  return { status: 'running', runState: { state: 'orphaned', reason: 'x', heartbeatAgeSec: 999, pidAlive: false, sameHost: true } }
}

function deploying(): DeployStatus {
  return { status: 'deploying', runState: { state: 'running', reason: 'x', heartbeatAgeSec: 1, pidAlive: true, sameHost: true } }
}

describe('usePipelineRunningCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts at 0/0 when there is nothing to poll', () => {
    const { result } = renderHook(() => usePipelineRunningCount(null))
    expect(result.current).toEqual({ ciRunning: 0, deployRunning: 0 })
  })

  it('counts records the classifier confirms are running', async () => {
    vi.mocked(api.getCiStatus).mockImplementation(async (name: string) =>
      name === 'a' ? running() : null,
    )
    vi.mocked(api.getDeployStatus).mockImplementation(async (name: string) =>
      name === 'b' ? deploying() : null,
    )

    const { result } = renderHook(() => usePipelineRunningCount([project('a'), project('b')]))

    await waitFor(() => {
      expect(result.current).toEqual({ ciRunning: 1, deployRunning: 1 })
    })
  })

  it('excludes orphaned records from the running count', async () => {
    vi.mocked(api.getCiStatus).mockResolvedValue(orphaned())
    vi.mocked(api.getDeployStatus).mockResolvedValue(null)

    const { result } = renderHook(() => usePipelineRunningCount([project('a')]))

    await waitFor(() => {
      expect(api.getCiStatus).toHaveBeenCalled()
    })
    expect(result.current).toEqual({ ciRunning: 0, deployRunning: 0 })
  })
})
