import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AddProjectDropdown } from './add-project-dropdown'
import { getUnregistered } from '@/lib/api-projects'

vi.mock('@/lib/api-projects', () => ({
  getUnregistered: vi.fn(),
  registerProject: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; className?: string }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

describe('AddProjectDropdown', () => {
  it('bounds the unregistered-projects list with its own scroll container', async () => {
    vi.mocked(getUnregistered).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => `project-${i + 1}`),
    )
    const user = userEvent.setup()
    render(<AddProjectDropdown onRegistered={() => {}} />)

    await user.click(screen.getByRole('button', { name: /Add Project/i }))
    const firstRow = await screen.findByText('project-1')
    const listContainer = firstRow.closest('div')

    expect(listContainer?.className).toContain('overflow-auto')
    expect(listContainer?.className).toMatch(/max-h-\[/)
    expect(screen.getByText('project-20')).toBeTruthy()
  })
})
