import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ProjectHeader } from './project-header'

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => React.createElement('span', {}, children),
}))

function baseProps() {
  return {
    name: 'myapp',
    domain: 'myapp.example.com',
    variant: 'ok' as const,
    label: 'Healthy',
    base: '/projects/myapp',
    deploying: false,
    unreachable: false,
    onDeployClick: vi.fn(),
    onRollbackClick: vi.fn(),
    onSecretsSyncClick: vi.fn(),
    onDestroyClick: vi.fn(),
  }
}

describe('ProjectHeader', () => {
  it('enables Deploy, Rollback and Sync Secrets when reachable', () => {
    render(<ProjectHeader {...baseProps()} />)
    expect((screen.getByText('Deploy').closest('button') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByText('Rollback').closest('button') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByText('Sync Secrets').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables Deploy, Rollback and Sync Secrets with a stated reason when unreachable', () => {
    render(<ProjectHeader {...baseProps()} unreachable />)
    const deployBtn = screen.getByText('Deploy').closest('button') as HTMLButtonElement
    const rollbackBtn = screen.getByText('Rollback').closest('button') as HTMLButtonElement
    const secretsBtn = screen.getByText('Sync Secrets').closest('button') as HTMLButtonElement
    expect(deployBtn.disabled).toBe(true)
    expect(rollbackBtn.disabled).toBe(true)
    expect(secretsBtn.disabled).toBe(true)
    expect(deployBtn.title).toMatch(/ssh/i)
    expect(rollbackBtn.title).toMatch(/ssh/i)
    expect(secretsBtn.title).toMatch(/ssh/i)
  })

  it('never shows "Running…" while unreachable and not deploying', () => {
    render(<ProjectHeader {...baseProps()} unreachable />)
    expect(screen.getByText('Deploy')).toBeTruthy()
    expect(screen.queryByText('Running…')).toBeNull()
  })

  it('leaves Destroy enabled when unreachable', () => {
    render(<ProjectHeader {...baseProps()} unreachable />)
    expect((screen.getByText('Destroy').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not call onDeployClick when the disabled Deploy button is clicked', async () => {
    const onDeployClick = vi.fn()
    const user = userEvent.setup()
    render(<ProjectHeader {...baseProps()} unreachable onDeployClick={onDeployClick} />)
    await user.click(screen.getByText('Deploy').closest('button')!)
    expect(onDeployClick).not.toHaveBeenCalled()
  })
})
