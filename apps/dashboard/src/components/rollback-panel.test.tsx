import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { RollbackPanel } from './rollback-panel'
import { getRollbackSnapshots } from '@/lib/api-projects'

vi.mock('@/lib/api-projects', () => ({
  getRollbackSnapshots: vi.fn(),
  rollbackProject: vi.fn(() => ({ url: 'http://x/rollback', body: '{}' })),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('RollbackPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRollbackSnapshots).mockResolvedValue(['project:2026-09-01', 'project:2026-08-15'])
  })

  it('opens the sheet in the viewport as soon as it is shown', async () => {
    render(<RollbackPanel name="myapp" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Rollback myapp' })).toBeTruthy()
    await waitFor(() => screen.getByText('2026-09-01'))
  })
})
