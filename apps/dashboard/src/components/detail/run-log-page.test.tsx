import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { RunLogPage } from './run-log-page'
import { getCiLog, getDeployLog, type LogResult } from '@/lib/api-history'
import { getCiStatus, getDeployStatus } from '@/lib/api-containers'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/lib/api-history', () => ({
  getCiLog: vi.fn(),
  getDeployLog: vi.fn(),
}))

vi.mock('@/lib/api-containers', () => ({
  getCiStatus: vi.fn(),
  getDeployStatus: vi.fn(),
}))

function mockLog(result: LogResult) {
  vi.mocked(getDeployLog).mockResolvedValue(result)
  vi.mocked(getCiLog).mockResolvedValue(result)
  vi.mocked(getDeployStatus).mockResolvedValue({ status: 'deployed' })
  vi.mocked(getCiStatus).mockResolvedValue({ status: 'success' })
}

describe('RunLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies ANSI-free plain text', async () => {
    mockLog({ content: '\x1b[32mBuild ok\x1b[0m\nLine 2', predatesCapture: false })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<RunLogPage type="deploy" name="tastease" sha="abc1234567890" />)
    await screen.findByText('Build ok')

    const [copyButton] = screen.getAllByText('Copy')
    await userEvent.click(copyButton!)

    expect(writeText).toHaveBeenCalledWith('Build ok\nLine 2')
  })

  it('download uses the expected filename', async () => {
    mockLog({ content: 'plain log content', predatesCapture: false })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock')
    global.URL.revokeObjectURL = vi.fn()
    const realCreateElement = document.createElement.bind(document)
    let downloadName = ''
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === 'a') {
        Object.defineProperty(el, 'download', { set: (v: string) => { downloadName = v }, get: () => downloadName })
      }
      return el
    })

    render(<RunLogPage type="deploy" name="tastease" sha="abc1234567890" />)
    await screen.findByText('plain log content')

    const [downloadButton] = screen.getAllByText('Download')
    await userEvent.click(downloadButton!)

    expect(downloadName).toBe('tastease-deploy-abc1234.log')
    expect(clickSpy).toHaveBeenCalled()
  })

  it('filter hides non-matching lines', async () => {
    mockLog({ content: 'Building image\nERROR: build failed\ndone', predatesCapture: false })

    const { container } = render(<RunLogPage type="ci" name="tastease" sha="abc1234567890" />)
    await screen.findByText('Building image')

    const [filterInput] = screen.getAllByPlaceholderText('Filter…')
    await userEvent.type(filterInput!, 'error')

    const body = container.querySelector('.ec-term-body')
    expect(body?.textContent).not.toContain('Building image')
    expect(body?.textContent).not.toContain('done')
    expect(body?.textContent).toContain('ERROR: build failed')
  })

  it('shows "No log found for this run" for an unknown sha', async () => {
    mockLog({ content: null, predatesCapture: false })

    render(<RunLogPage type="deploy" name="tastease" sha={'0'.repeat(40)} />)

    expect(await screen.findByText('No log found for this run')).toBeTruthy()
  })

  it('only says "predates log capture" when the history entry confirms it', async () => {
    mockLog({ content: null, predatesCapture: true })

    render(<RunLogPage type="deploy" name="tastease" sha="abc1234567890" />)

    expect(await screen.findByText('Log not available — this run predates log capture')).toBeTruthy()
  })
})
