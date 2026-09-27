// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import type { AgentRendererApi, AgentState } from '../src/shared/contracts'

afterEach(cleanup)

const unpaired: AgentState = {
  lifecycle: 'needs-pairing', systemName: 'DESKTOP-ABC123', device: null, backend: null, error: null
}

describe('Agent UI', () => {
  it('shows detected systemName and submits pairingCode/displayName only', async () => {
    const pairDevice = vi.fn().mockResolvedValue({ ...unpaired, lifecycle: 'connecting' })
    installApi({ pairDevice })
    render(<App />)
    expect(await screen.findByText('DESKTOP-ABC123')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '482193' } })
    fireEvent.change(screen.getByLabelText('Computer name'), { target: { value: 'Packing Station' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair computer' }))
    await vi.waitFor(() => expect(pairDevice).toHaveBeenCalledWith({ pairingCode: '482193', displayName: 'Packing Station' }))
    expect(JSON.stringify(pairDevice.mock.calls)).not.toContain('deviceCredential')
  })

  it('renders backend-authoritative connected state without Pause/Resume actions', async () => {
    installApi({
      getState: vi.fn().mockResolvedValue({
        ...unpaired,
        lifecycle: 'connected',
        device: { id: '1', systemName: 'DESKTOP-ABC123', displayName: 'Packing Station', platform: 'windows', agentVersion: '1.0.0' },
        backend: { isPaused: true, systemBlocked: false, mercadoLibreStatus: 'CONNECTED', queueCount: 3, updateStatus: 'CURRENT' }
      })
    })
    render(<App />)
    expect(await screen.findByText('Packing Station')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pause|resume/i })).not.toBeInTheDocument()
  })
})

function installApi(overrides: Partial<AgentRendererApi>): void {
  const api: AgentRendererApi = {
    getState: vi.fn().mockResolvedValue(unpaired),
    pairDevice: vi.fn(),
    subscribeToState: vi.fn().mockReturnValue(() => undefined),
    getStartWithWindows: vi.fn().mockResolvedValue(true),
    setStartWithWindows: vi.fn().mockImplementation(async (enabled: boolean) => enabled),
    ...overrides
  }
  Object.defineProperty(window, 'notiventa', { configurable: true, value: api })
}
