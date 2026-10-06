import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentController } from '../src/main/agent-controller'
import { BackendError, DefinitiveDeviceAuthenticationError, type NotiVentaApiClient } from '../src/main/api-client'
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
  job: null,
  pollAfterSeconds: 5
}
const receivedJob = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  printType: 'SHIPPING_LABEL' as const,
  shipmentId: '200000001',
  orderId: '300000001'
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

  it('recovers assignment state before beginning normal polling', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      recoverCurrentAssignment: vi.fn().mockResolvedValue(null)
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.recoverCurrentAssignment).toHaveBeenCalledWith('stored-secret')
    expect(api.recoverCurrentAssignment.mock.invocationCallOrder[0]).toBeLessThan(api.poll.mock.invocationCallOrder[0])
    created.controller.shutdown()
  })

  it('persists a recovered assignment before acknowledging it and then polls', async () => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      recoverCurrentAssignment: vi.fn().mockResolvedValue(receivedJob),
      acknowledgeReceipt: vi.fn(() => {
        expect(settings.getPendingReceipt()).toEqual({
          kind: 'valid', receipt: { version: 1, job: receivedJob }
        })
        return Promise.resolve()
      })
    }
    const created = createController(api, { settings })
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.poll).not.toHaveBeenCalled()
    expect(api.acknowledgeReceipt).toHaveBeenCalledWith('stored-secret', receivedJob.attemptId)
    expect(settings.pendingReceiptWrites).toEqual([{ version: 1, job: receivedJob }])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.acknowledgeReceipt.mock.invocationCallOrder[0]).toBeLessThan(api.poll.mock.invocationCallOrder[0])
    created.controller.shutdown()
  })

  it('does not poll while current-assignment recovery is temporarily unavailable', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      recoverCurrentAssignment: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(null)
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.poll).not.toHaveBeenCalled()
    expect(created.controller.getState().error).toBe('Current job assignment recovery is pending.')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.recoverCurrentAssignment).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.poll).toHaveBeenCalledOnce()
    created.controller.shutdown()
  })

  it.each([404, 409])('stops safely on terminal current-assignment recovery status %i', async (status) => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      recoverCurrentAssignment: vi.fn().mockRejectedValue(new BackendError('recovery rejected', status, null, false))
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(api.poll).not.toHaveBeenCalled()
    expect(created.controller.getState().error).toBe('Current job assignment could not be recovered safely.')
    created.controller.shutdown()
  })

  it('restores a recovered persisted receipt after restart without a second recovery request', async () => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const firstApi = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      recoverCurrentAssignment: vi.fn().mockResolvedValue(receivedJob),
      acknowledgeReceipt: vi.fn().mockRejectedValue(new Error('offline'))
    }
    const first = createController(firstApi, { credentials, settings })

    await first.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(settings.getPendingReceipt()).toEqual({ kind: 'valid', receipt: { version: 1, job: receivedJob } })
    first.controller.shutdown()

    const secondApi = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      recoverCurrentAssignment: vi.fn(),
      acknowledgeReceipt: vi.fn().mockResolvedValue(undefined)
    }
    const second = createController(secondApi, { credentials, settings })
    await second.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(secondApi.recoverCurrentAssignment).not.toHaveBeenCalled()
    expect(secondApi.acknowledgeReceipt).toHaveBeenCalledWith('stored-secret', receivedJob.attemptId)
    second.controller.shutdown()
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

  it('records a received job in Agent state without invoking a printer', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue({ ...pollResult, job: receivedJob }),
      acknowledgeReceipt: vi.fn().mockResolvedValue(undefined)
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(created.controller.getState().receivedJob).toEqual(receivedJob)
    expect(api.poll).toHaveBeenCalledOnce()
    expect(api.acknowledgeReceipt).toHaveBeenCalledWith('stored-secret', '22222222-2222-4222-8222-222222222222')
    expect(created.settings.pendingReceiptWrites).toEqual([{ version: 1, job: receivedJob }])
    expect(created.settings.pendingReceiptClearCount).toBe(1)
    created.controller.shutdown()
  })

  it('persists a validated receipt before sending its acknowledgement', async () => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue({ ...pollResult, job: receivedJob }),
      acknowledgeReceipt: vi.fn(() => {
        expect(settings.getPendingReceipt()).toEqual({
          kind: 'valid',
          receipt: { version: 1, job: receivedJob }
        })
        return Promise.resolve()
      })
    }
    const created = createController(api, { settings })
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.acknowledgeReceipt).toHaveBeenCalledOnce()
    expect(settings.pendingReceiptClearCount).toBe(1)
    created.controller.shutdown()
  })

  it('does not acknowledge a malformed job because polling rejects it first', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockRejectedValue(new Error('invalid job payload')),
      acknowledgeReceipt: vi.fn()
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.acknowledgeReceipt).not.toHaveBeenCalled()
    expect(created.controller.getState().receivedJob).toBeNull()
    created.controller.shutdown()
  })

  it('keeps the received job and retries a temporary receipt acknowledgement failure', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue({ ...pollResult, job: receivedJob }),
      acknowledgeReceipt: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(created.controller.getState().receivedJob).toEqual(receivedJob)
    expect(created.controller.getState().error).toBe('Job receipt acknowledgement is pending.')
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'valid', receipt: { version: 1, job: receivedJob } })
    expect(api.poll).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.acknowledgeReceipt).toHaveBeenCalledTimes(2)
    expect(created.controller.getState().error).toBeNull()
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'none' })
    created.controller.shutdown()
  })

  it('retries an idempotent acknowledgement when clearing local receipt state fails after server success', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue({ ...pollResult, job: receivedJob }),
      acknowledgeReceipt: vi.fn().mockResolvedValue(undefined)
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'
    created.settings.pendingReceiptClearFailuresRemaining = 1

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.acknowledgeReceipt).toHaveBeenCalledOnce()
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'valid', receipt: { version: 1, job: receivedJob } })
    expect(api.poll).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.acknowledgeReceipt).toHaveBeenCalledTimes(2)
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'none' })
    created.controller.shutdown()
  })

  it('does not acknowledge or poll while receipt persistence is failing', async () => {
    vi.useFakeTimers()
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue({ ...pollResult, job: receivedJob }),
      acknowledgeReceipt: vi.fn().mockResolvedValue(undefined)
    }
    const created = createController(api)
    created.credentials.credential = 'stored-secret'
    created.settings.pendingReceiptWriteFailuresRemaining = 1

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.acknowledgeReceipt).not.toHaveBeenCalled()
    expect(created.controller.getState().receivedJob).toBeNull()
    expect(created.controller.getState().error).toBe('Job receipt could not be saved safely. NotiVenta will not request more work.')
    expect(api.poll).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.acknowledgeReceipt).toHaveBeenCalledWith('stored-secret', receivedJob.attemptId)
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'none' })
    created.controller.shutdown()
  })

  it('restores a pending receipt, acknowledges it before polling, then resumes polling', async () => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    settings.pendingReceipt = { version: 1, job: receivedJob }
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      acknowledgeReceipt: vi.fn().mockResolvedValue(undefined)
    }
    const created = createController(api, { credentials, settings })

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.acknowledgeReceipt).toHaveBeenCalledWith('stored-secret', receivedJob.attemptId)
    expect(api.poll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.acknowledgeReceipt.mock.invocationCallOrder[0]).toBeLessThan(api.poll.mock.invocationCallOrder[0])
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'none' })
    expect(created.controller.getState().lifecycle).toBe('connected')
    created.controller.shutdown()
  })

  it('keeps restored receipt state and does not poll while acknowledgement is temporarily unavailable', async () => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    settings.pendingReceipt = { version: 1, job: receivedJob }
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      acknowledgeReceipt: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    }
    const created = createController(api, { credentials, settings })

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.poll).not.toHaveBeenCalled()
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'valid', receipt: { version: 1, job: receivedJob } })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.acknowledgeReceipt).toHaveBeenCalledTimes(2)
    expect(api.poll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.poll).toHaveBeenCalledOnce()
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'none' })
    created.controller.shutdown()
  })

  it.each([404, 409])('holds a restored receipt and stops polling after terminal acknowledgement status %i', async (status) => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    settings.pendingReceipt = { version: 1, job: receivedJob }
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const api = {
      pair: vi.fn(),
      poll: vi.fn().mockResolvedValue(pollResult),
      acknowledgeReceipt: vi.fn().mockRejectedValue(new BackendError('receipt rejected', status, null, false))
    }
    const created = createController(api, { credentials, settings })

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(api.poll).not.toHaveBeenCalled()
    expect(created.settings.getPendingReceipt()).toEqual({ kind: 'valid', receipt: { version: 1, job: receivedJob } })
    expect(created.controller.getState().error).toBe('Job receipt acknowledgement could not be confirmed.')
    created.controller.shutdown()
  })

  it('does not acknowledge malformed persisted receipt state or request new work', async () => {
    vi.useFakeTimers()
    const settings = new MemorySettingsStore()
    settings.pendingReceipt = { version: 999, job: receivedJob }
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const api = { pair: vi.fn(), poll: vi.fn(), acknowledgeReceipt: vi.fn() }
    const created = createController(api, { credentials, settings })

    await created.controller.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.acknowledgeReceipt).not.toHaveBeenCalled()
    expect(api.poll).not.toHaveBeenCalled()
    expect(created.controller.getState().error).toBe('Pending job receipt data is invalid. NotiVenta will not request more work.')
    created.controller.shutdown()
  })
})

function createController(api: {
  pair: ReturnType<typeof vi.fn>
  poll: ReturnType<typeof vi.fn>
  acknowledgeReceipt?: ReturnType<typeof vi.fn>
  recoverCurrentAssignment?: ReturnType<typeof vi.fn>
}, stores?: {
  credentials?: MemoryCredentialStore
  settings?: MemorySettingsStore
}) {
  const credentials = stores?.credentials ?? new MemoryCredentialStore()
  const settings = stores?.settings ?? new MemorySettingsStore()
  const client = {
    recoverCurrentAssignment: vi.fn().mockResolvedValue(null),
    ...api
  }
  const controller = new AgentController(client as unknown as NotiVentaApiClient, credentials, settings, 'DESKTOP-1')
  return { controller, credentials, settings }
}
