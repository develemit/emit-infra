import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import LogsPage from './page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/lib/api', () => ({
  getProjects: vi.fn().mockResolvedValue([
    { config: { name: 'healthy-app', domain: 'healthy.example.com' } },
    { config: { name: 'down-app', domain: 'down.example.com' } },
  ]),
  getStatus: vi.fn((name: string) =>
    name === 'down-app'
      ? Promise.reject(new Error('unreachable'))
      : Promise.resolve({ disk: 10, memory: 10 }),
  ),
}))

describe('LogsPage', () => {
  it('shows a reachability dot per project reflecting its status', async () => {
    render(<LogsPage />)

    await waitFor(() => {
      expect(screen.getByText('healthy-app')).toBeTruthy()
      expect(screen.getByText('down-app')).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Healthy' })).toBeTruthy()
      expect(screen.getByRole('status', { name: 'Unreachable' })).toBeTruthy()
    })
  })
})
