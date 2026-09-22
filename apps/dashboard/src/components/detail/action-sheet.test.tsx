import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ActionSheet } from './action-sheet'

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('ActionSheet', () => {
  it('opens in the viewport with the given title and body', () => {
    render(
      <ActionSheet title="Deploying myapp" icon="deploy" onClose={vi.fn()}>
        <p>terminal output</p>
      </ActionSheet>,
    )
    expect(screen.getByRole('dialog', { name: 'Deploying myapp' })).toBeTruthy()
    expect(screen.getByText('terminal output')).toBeTruthy()
  })

  it('shows a close button and calls onClose when clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ActionSheet title="t" icon="deploy" onClose={onClose}>
        body
      </ActionSheet>,
    )
    const dialog = screen.getByRole('dialog')
    const closeBtn = dialog.querySelector('button')!
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides the close button while closeDisabled', () => {
    render(
      <ActionSheet title="t" icon="deploy" onClose={vi.fn()} closeDisabled>
        body
      </ActionSheet>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('button')).toBeNull()
  })

  it('closes on backdrop click unless closeDisabled', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container, rerender } = render(
      <ActionSheet title="t" icon="deploy" onClose={onClose}>
        body
      </ActionSheet>,
    )
    const backdrop = container.firstElementChild as HTMLElement
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    rerender(
      <ActionSheet title="t" icon="deploy" onClose={onClose} closeDisabled>
        body
      </ActionSheet>,
    )
    await user.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders above the mobile tab bar and as a desktop-width right drawer', () => {
    const { container } = render(
      <ActionSheet title="t" icon="deploy" onClose={vi.fn()}>
        body
      </ActionSheet>,
    )
    const panel = container.children[1] as HTMLElement
    expect(panel.className).toContain('z-[60]')
    expect(panel.className).toContain('lg:w-[440px]')
  })
})
