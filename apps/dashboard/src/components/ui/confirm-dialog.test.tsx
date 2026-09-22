import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ConfirmDialog } from './confirm-dialog'

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('ConfirmDialog', () => {
  it('renders title, subtitle and body', () => {
    render(
      <ConfirmDialog title="Deploy myapp?" subtitle="current build 42" confirmLabel="Deploy" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>body text</p>
      </ConfirmDialog>,
    )
    expect(screen.getByText('Deploy myapp?')).toBeTruthy()
    expect(screen.getByText('current build 42')).toBeTruthy()
    expect(screen.getByText('body text')).toBeTruthy()
  })

  it('calls onConfirm and onCancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="t" confirmLabel="Go" onConfirm={onConfirm} onCancel={onCancel}>
        body
      </ConfirmDialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons while busy', () => {
    render(
      <ConfirmDialog title="t" confirmLabel="Go" busy onConfirm={vi.fn()} onCancel={vi.fn()}>
        body
      </ConfirmDialog>,
    )
    expect((screen.getByRole('button', { name: 'Go' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders above the mobile tab bar (higher z-index, bottom clearance)', () => {
    const { container } = render(
      <ConfirmDialog title="t" confirmLabel="Go" onConfirm={vi.fn()} onCancel={vi.fn()}>
        body
      </ConfirmDialog>,
    )
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.className).toContain('z-[60]')
    expect(overlay.className).toMatch(/pb-\[calc\(4rem/)
  })
})
