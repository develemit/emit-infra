import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { MobileActionBar } from './mobile-action-bar'

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

function baseProps() {
  return {
    name: 'myapp',
    base: '/projects/myapp',
    deploying: false,
    unreachable: false,
    sheetOpen: false,
    onDeployClick: vi.fn(),
    onSecretsSyncClick: vi.fn(),
    onRollbackClick: vi.fn(),
    onDestroyClick: vi.fn(),
  }
}

describe('MobileActionBar', () => {
  it('offers every desktop header action, including Ask Claude', () => {
    render(<MobileActionBar {...baseProps()} />)
    expect(screen.getByText('Logs').closest('a')?.getAttribute('href')).toBe('/projects/myapp/logs')
    expect(screen.getByText('Claude').closest('a')?.getAttribute('href')).toBe('/ops?project=myapp')
    expect(screen.getByText('Secrets')).toBeTruthy()
    expect(screen.getByText('Rollback')).toBeTruthy()
    expect(screen.getByText('Deploy')).toBeTruthy()
    expect(screen.getByText('Destroy')).toBeTruthy()
  })

  it('disables Deploy, Secrets and Rollback while an action sheet is open', () => {
    render(<MobileActionBar {...baseProps()} sheetOpen />)
    expect((screen.getByText('Deploy').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Secrets').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Rollback').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('leaves Destroy enabled while an action sheet is open', () => {
    render(<MobileActionBar {...baseProps()} sheetOpen />)
    expect((screen.getByText('Destroy').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })
})
