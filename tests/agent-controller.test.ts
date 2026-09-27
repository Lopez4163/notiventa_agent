import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentController } from '../src/main/agent-controller'
import { DefinitiveDeviceAuthenticationError, type NotiVentaApiClient } from '../src/main/api-client'
import { MemoryCredentialStore, MemorySettingsStore } from './test-doubles'

afterEach(() => vi.useRealTimers())

const pairResult = {
  device: {
    id: 'device-1', systemName: 'DESKTOP-1', displayName: 'Packing Station',
    platform: 'windows', agentVersion: '1.0.0', isPaused: false, lastSeenAt: 'now'
  },
  deviceCredential: 'raw-device-secret'
}
const pollResult = {
  backend: { isPaused: false, systemBlocked: false, mercadoLibreStatus: 'CONNECTED' as const, queueCount: 0, updateStatus: 'CURRENT' as const },
  pollAfterSeconds: 5
}

describe('AgentController lifecycle', () => {
  it('starts in pairing when no credential exists', async () => {
    const controller = createController({ pair: vi.fn(), poll: vi.fn() })
    await controller.controller.initialize()
    expect(controller.controller.getState().lifecycle).toBe('needs-pairing')
  })

  it('hands the credential directly to CredentialStore and never state/settings', async () => {
    vi.useFakeTimers()
    const api = { pair: vi.fn().mockResolvedValue(pairResult), poll: vi.fn().mockResolvedValue(pollResult) }
    const { controller, credentials, settings } = createController(api)
    const state = await controller.pair({ pairingCode: '482193', displayName: 'Packing Station' })
    expect(credentials.credential).toBe('raw-device-secret')
    expect(credentials.writes).toEqual(['raw-device-secret'])
    expect(JSON.stringify(state)).not.toContain('raw-device-secret')
    expect(JSON.stringify(settings)).not.toContain('raw-device-secret')
    controller.shutdown()
  })

  it('keeps a failed credential write in Main and retries without pairing again', async () => {
    vi.useFakeTimers()
    const api = { pair: vi.fn().mockResolvedValue(pairResult), poll: vi.fn().mockResolvedValue(pollResult) }
    const created = createController(api)
    created.credentials.failedWritesRemaining = 1

    const failedState = await created.controller.pair({ pairingCode: '482193', displayName: 'Packing Station' })
    expect(api.pair).toHaveBeenCalledOnce()
    expect(created.credentials.credential).toBeNull()
    expect(failedState.lifecycle).toBe('credential-storage-retry-required')
    expect(failedState.error).toBe('This computer was paired, but NotiVenta could not securely save its credential. Keep the app open while it retries.')
    expect(JSON.stringify(failedState)).not.toContain('raw-device-secret')
    expect(JSON.stringify(created.settings)).not.toContain('raw-device-secret')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.pair).toHaveBeenCalledOnce()
    expect(created.credentials.credential).toBe('raw-device-secret')
    expect((created.controller as unknown as { pendingCredential: string | null }).pendingCredential).toBeNull()
    expect(created.controller.getState().error).toBeNull()
    created.controller.shutdown()
  })

  it('restores a credential, polls immediately, and becomes connected', async () => {
    vi.useFakeTimers()
    const api = { pair: vi.fn(), poll: vi.fn().mockResolvedValue(pollResult) }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'
    await created.controller.initialize()
    expect(created.controller.getState().lifecycle).toBe('connecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.poll).toHaveBeenCalledWith('stored-secret')
    expect(created.controller.getState().lifecycle).toBe('connected')
    created.controller.shutdown()
  })

  it('keeps the credential during temporary backend loss and recovers', async () => {
    vi.useFakeTimers()
    const api = { pair: vi.fn(), poll: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(pollResult) }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'
    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(created.controller.getState().lifecycle).toBe('disconnected')
    expect(created.credentials.credential).toBe('stored-secret')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(created.controller.getState().lifecycle).toBe('connected')
    created.controller.shutdown()
  })

  it('clears a definitively invalid credential and returns to pairing', async () => {
    vi.useFakeTimers()
    const api = { pair: vi.fn(), poll: vi.fn().mockRejectedValue(new DefinitiveDeviceAuthenticationError()) }
    const created = createController(api)
    created.credentials.credential = 'revoked-secret'
    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(created.credentials.credential).toBeNull()
    expect(created.credentials.clearCount).toBe(1)
    expect(created.controller.getState().lifecycle).toBe('needs-pairing')
  })
})

function createController(api: { pair: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> }) {
  const credentials = new MemoryCredentialStore()
  const settings = new MemorySettingsStore()
  const controller = new AgentController(api as unknown as NotiVentaApiClient, credentials, settings, 'DESKTOP-1')
  return { controller, credentials, settings }
}
