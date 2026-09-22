import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { SplashGate } from './splash-screen'

describe('SplashGate', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('shows the splash on a cold start (nothing in sessionStorage yet)', () => {
    render(<SplashGate />)
    expect(screen.getByRole('status', { name: 'Loading Emit Infra' })).toBeTruthy()
  })

  it('skips the splash on a later load in the same session', async () => {
    window.sessionStorage.setItem('emit:booted', '1')
    render(<SplashGate />)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('dismisses a cold start once emit:ready fires, regardless of route', async () => {
    render(<SplashGate minDuration={0} />)
    expect(screen.getByRole('status')).toBeTruthy()

    act(() => {
      window.dispatchEvent(new Event('emit:ready'))
    })

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})
