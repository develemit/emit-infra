import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { DockerUsage } from './docker-usage'
import { getDockerUsage, pruneDocker } from '@/lib/api-containers'

vi.mock('@/lib/api-containers', () => ({
  getDockerUsage: vi.fn(),
  pruneDocker: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

const ROWS = [
  { type: 'Images', total: 5, active: 2, size: '1.2GB', reclaimable: '800MB (66%)' },
  { type: 'Containers', total: 1, active: 1, size: '10MB', reclaimable: '0B (0%)' },
]

describe('DockerUsage prune confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDockerUsage).mockResolvedValue(ROWS)
    vi.mocked(pruneDocker).mockResolvedValue({ ok: true, output: 'pruned' })
  })

  it('clicking Prune opens a confirm naming what will be removed, without pruning yet', async () => {
    const user = userEvent.setup()
    render(<DockerUsage projectName="myapp" />)
    await waitFor(() => screen.getByRole('button', { name: /prune/i }))

    await user.click(screen.getByRole('button', { name: /prune/i }))

    expect(screen.getByText('Prune Docker resources?')).toBeTruthy()
    expect(screen.getByText('800MB')).toBeTruthy()
    expect(pruneDocker).not.toHaveBeenCalled()
  })

  it('confirming the dialog calls pruneDocker', async () => {
    const user = userEvent.setup()
    render(<DockerUsage projectName="myapp" />)
    await waitFor(() => screen.getByRole('button', { name: /prune/i }))

    await user.click(screen.getByRole('button', { name: /^prune$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^prune$/i }))

    await waitFor(() => expect(pruneDocker).toHaveBeenCalledWith('myapp'))
  })

  it('cancel dismisses without pruning', async () => {
    const user = userEvent.setup()
    render(<DockerUsage projectName="myapp" />)
    await waitFor(() => screen.getByRole('button', { name: /prune/i }))

    await user.click(screen.getByRole('button', { name: /^prune$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Prune Docker resources?')).toBeNull()
    expect(pruneDocker).not.toHaveBeenCalled()
  })
})
