import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentController } from '../src/main/agent-controller'
import { BackendError, DefinitiveDeviceAuthenticationError, type NotiVentaApiClient } from '../src/main/api-client'
import { MemoryCredentialStore, MemoryResultOutbox, MemorySettingsStore } from './test-doubles'

const job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  printType: 'SHIPPING_LABEL' as const,
  shipmentId: '200000001',
  orderId: '300000001'
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function create(withActiveJob = true) {
  const credentials = new MemoryCredentialStore()
  credentials.credential = 'stored-secret'
  const settings = new MemorySettingsStore()
  if (withActiveJob) settings.activeAssignment = { version: 1, job }
  const outbox = new MemoryResultOutbox()
  const api = {
    pair: vi.fn(), poll: vi.fn(), acknowledgeReceipt: vi.fn(),
    recoverCurrentAssignment: vi.fn().mockResolvedValue(null),
    submitPrintEvent: vi.fn().mockResolvedValue(undefined)
  }
  const controller = new AgentController(api as unknown as NotiVentaApiClient, credentials, settings, 'DESKTOP-1', outbox)
  return { controller, credentials, settings, outbox, api }
}

describe('AgentController durable result outbox', () => {
  it('persists a result before submitting its exact PF1 payload and clears it only after ACK', async () => {
    const created = create()
    created.api.submitPrintEvent.mockImplementation(async (_credential, event) => {
      expect(created.outbox.events).toEqual([event])
    })
    await created.controller.initialize()
    created.controller.recordPrintResult({ ...job, type: 'PRINTED_SUCCESSFULLY', executionMode: 'SIMULATED' })
    await vi.waitFor(() => expect(created.api.submitPrintEvent).toHaveBeenCalledOnce())

    const event = created.api.submitPrintEvent.mock.calls[0][1]
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(event.jobId).toBe(job.jobId)
    expect(created.outbox.events).toEqual([])
    expect(created.settings.getActiveAssignment()).toEqual({ kind: 'none' })
    created.controller.shutdown()
  })

  it('keeps the same event after a temporary failure and resends it after restart', async () => {
    vi.useFakeTimers()
    const first = create()
    first.api.submitPrintEvent.mockRejectedValueOnce(new Error('offline'))
    await first.controller.initialize()
    first.controller.recordPrintResult({ ...job, type: 'PRINTED_SUCCESSFULLY', executionMode: 'SIMULATED' })
    await vi.advanceTimersByTimeAsync(0)
    const saved = first.outbox.events[0]
    expect(saved).toBeDefined()
    first.controller.shutdown()

    const secondApi = {
      pair: vi.fn(), poll: vi.fn(), acknowledgeReceipt: vi.fn(), recoverCurrentAssignment: vi.fn(),
      submitPrintEvent: vi.fn().mockResolvedValue(undefined)
    }
    const second = new AgentController(secondApi as unknown as NotiVentaApiClient, first.credentials, first.settings, 'DESKTOP-1', first.outbox)
    await second.initialize()
    expect(secondApi.submitPrintEvent).toHaveBeenCalledWith('stored-secret', saved)
    expect(first.outbox.events).toEqual([])
    second.shutdown()
  })

  it('treats a lost ACK as a resend of the same event, never new execution', async () => {
    vi.useFakeTimers()
    const created = create()
    created.api.submitPrintEvent.mockRejectedValueOnce(new Error('connection reset after backend ACK'))
    await created.controller.initialize()
    created.controller.recordPrintResult({ ...job, type: 'UNKNOWN', executionMode: 'SIMULATED' })
    await vi.advanceTimersByTimeAsync(0)
    const original = created.outbox.events[0]
    created.api.submitPrintEvent.mockResolvedValueOnce(undefined)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(created.api.submitPrintEvent).toHaveBeenNthCalledWith(2, 'stored-secret', original)
    expect(created.outbox.events).toEqual([])
    created.controller.shutdown()
  })

  it('does not authorize the physical boundary until the durable PRINTING event is acknowledged', async () => {
    const created = create()
    await created.controller.initialize()
    await expect(created.controller.recordPrintResultAndAwaitAcknowledgement({
      ...job, type: 'PRINTING', executionMode: 'PHYSICAL'
    })).resolves.toBe(true)
    expect(created.api.submitPrintEvent).toHaveBeenCalledWith('stored-secret', expect.objectContaining({
      type: 'PRINTING', executionMode: 'PHYSICAL', attemptId: job.attemptId
    }))
    expect(created.outbox.events).toEqual([])
    expect(created.settings.getActiveAssignment()).toEqual({ kind: 'valid', assignment: { version: 1, job } })
    created.controller.shutdown()
  })

  it('keeps an unacknowledged physical PRINTING event durable and returns false', async () => {
    const created = create()
    created.api.submitPrintEvent.mockRejectedValueOnce(new Error('network lost'))
    await created.controller.initialize()
    await expect(created.controller.recordPrintResultAndAwaitAcknowledgement({
      ...job, type: 'PRINTING', executionMode: 'PHYSICAL'
    })).resolves.toBe(false)
    expect(created.outbox.events).toHaveLength(1)
    expect(created.outbox.events[0]).toMatchObject({ type: 'PRINTING', executionMode: 'PHYSICAL' })
    expect(created.settings.getActiveAssignment()).toEqual({ kind: 'valid', assignment: { version: 1, job } })
    created.controller.shutdown()
  })

  it.each([
    new BackendError('conflict', 409, 'AGENT_EVENT_CONFLICT', false),
    new BackendError('simulated not allowed', 403, 'SIMULATED_PRINT_EVENT_NOT_ALLOWED', false)
  ])('keeps permanent PF1 rejection fail-closed', async (error) => {
    const created = create()
    created.api.submitPrintEvent.mockRejectedValue(error)
    await created.controller.initialize()
    created.controller.recordPrintResult({ ...job, type: 'PRINT_FAILED', executionMode: 'SIMULATED' })
    await vi.waitFor(() => expect(created.api.submitPrintEvent).toHaveBeenCalledOnce())
    expect(created.outbox.events).toHaveLength(1)
    expect(created.controller.getState().lifecycle).toBe('disconnected')
    expect(created.api.poll).not.toHaveBeenCalled()
    created.controller.shutdown()
  })

  it('preserves the outbox event when Device authentication fails', async () => {
    const created = create()
    created.api.submitPrintEvent.mockRejectedValue(new DefinitiveDeviceAuthenticationError())
    await created.controller.initialize()
    created.controller.recordPrintResult({ ...job, type: 'PRINT_FAILED', executionMode: 'SIMULATED' })
    await vi.waitFor(() => expect(created.credentials.clearCount).toBe(1))
    expect(created.outbox.events).toHaveLength(1)
    expect(created.controller.getState().lifecycle).toBe('needs-pairing')
    created.controller.shutdown()
  })

  it('flushes pending results before any recovery or poll and fails closed on corruption', async () => {
    const created = create()
    created.outbox.events.push({
      version: 1, eventId: '33333333-3333-4333-8333-333333333333', ...job,
      type: 'PRINTING', executionMode: 'PHYSICAL', occurredAt: '2026-10-08T15:00:00.000Z', errorCode: null, errorMessage: null, createdAt: '2026-10-08T15:00:00.000Z'
    })
    await created.controller.initialize()
    expect(created.api.submitPrintEvent).toHaveBeenCalledOnce()
    expect(created.api.recoverCurrentAssignment).not.toHaveBeenCalled()
    expect(created.api.poll).not.toHaveBeenCalled()
    created.controller.shutdown()

    const corrupt = create()
    corrupt.outbox.invalid = true
    await corrupt.controller.initialize()
    expect(corrupt.api.poll).not.toHaveBeenCalled()
    expect(corrupt.controller.getState().error).toContain('invalid')
    corrupt.controller.shutdown()
  })
})
