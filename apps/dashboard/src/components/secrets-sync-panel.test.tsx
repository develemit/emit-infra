import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SecretsSyncPanel } from './secrets-sync-panel'

vi.mock('@/lib/api-secrets', () => ({
  syncSecrets: vi.fn(() => ({ url: 'http://x/secrets-sync' })),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

function makeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.close() } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SecretsSyncPanel', () => {
  it('opens the sync output in an action sheet in the viewport', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ body: makeStream() } as Response))
    render(<SecretsSyncPanel name="myapp" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Sync Secrets — myapp' })).toBeTruthy()
  })

  it('hides the close control while syncing', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ body: new ReadableStream({ start() {} }) } as Response))
    render(<SecretsSyncPanel name="myapp" onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('button')).toBeNull()
  })
})
