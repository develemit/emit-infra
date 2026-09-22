import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { CostPanel } from './cost-panel'
import { getProjectCost, type ProjectCost } from '@/lib/api-infra'

vi.mock('@/lib/api-infra', () => ({
  getProjectCost: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

describe('CostPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never renders "null" when storage exists but totalBytes is null', async () => {
    const cost: ProjectCost = {
      server: { eurPerMonth: 4.5, type: 'cx22', region: 'nbg1' },
      storage: { usdPerMonth: 0.015, totalBytes: null, bucketName: 'bucket' },
    }
    vi.mocked(getProjectCost).mockResolvedValue(cost)
    render(<CostPanel name="myapp" />)

    await waitFor(() => {
      expect(screen.getByText('No backups stored')).toBeTruthy()
    })
    expect(screen.queryByText(/null/i)).toBeNull()
  })

  it('shows the formatted byte size when totalBytes is present', async () => {
    const cost: ProjectCost = {
      server: { eurPerMonth: 4.5, type: 'cx22', region: 'nbg1' },
      storage: { usdPerMonth: 0.015, totalBytes: 2048, bucketName: 'bucket' },
    }
    vi.mocked(getProjectCost).mockResolvedValue(cost)
    render(<CostPanel name="myapp" />)

    await waitFor(() => {
      expect(screen.getByText('2.0 KB stored')).toBeTruthy()
    })
  })
})
