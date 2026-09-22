import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { DeployPanel } from './deploy-panel'

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

function makeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.close() } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeployPanel confirm step', () => {
  it('shows the project name and current build before deploying', () => {
    render(<DeployPanel url="http://x/deploy" name="myapp" buildNumber="42" onClose={vi.fn()} />)
    expect(screen.getByText('Deploy myapp?')).toBeTruthy()
    expect(screen.getByText(/current build 42/)).toBeTruthy()
  })

  it('folds the disk/memory pressure warning into the confirm dialog', () => {
    render(<DeployPanel url="http://x/deploy" name="myapp" disk={85} memory={40} onClose={vi.fn()} />)
    expect(screen.getByText(/Disk at 85%, memory at 40%/)).toBeTruthy()
  })

  it('does not show the pressure warning when resources are healthy', () => {
    render(<DeployPanel url="http://x/deploy" name="myapp" disk={20} memory={20} onClose={vi.fn()} />)
    expect(screen.queryByText(/server may be under pressure/)).toBeNull()
  })

  it('does not start the deploy stream until confirmed', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ body: makeStream() } as Response))
    render(<DeployPanel url="http://x/deploy" name="myapp" onClose={vi.fn()} />)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancel closes without starting the deploy', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ body: makeStream() } as Response))
    const onClose = vi.fn()
    render(<DeployPanel url="http://x/deploy" name="myapp" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('confirming sends exactly one POST', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ body: makeStream() } as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DeployPanel url="http://x/deploy" name="myapp" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('confirming under React.StrictMode still sends exactly one POST', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ body: makeStream() } as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(
      <React.StrictMode>
        <DeployPanel url="http://x/deploy" name="myapp" onClose={vi.fn()} />
      </React.StrictMode>,
    )

    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
