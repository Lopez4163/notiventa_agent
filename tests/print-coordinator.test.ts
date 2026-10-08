import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentController } from '../src/main/agent-controller'
import { FakePrinterAdapter } from '../src/main/printers/fake-printer-adapter'
import type { PrinterAdapter, PrinterRequest } from '../src/main/printers/printer-adapter'
import { PrintCoordinator } from '../src/main/printing/print-coordinator'
import type { NotiVentaApiClient } from '../src/main/api-client'
import { MemoryCredentialStore, MemoryResultOutbox, MemorySettingsStore } from './test-doubles'

const request: PrinterRequest = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  document: { kind: 'SYNTHETIC_TEST' }
}

afterEach(() => vi.restoreAllMocks())

describe('FakePrinterAdapter', () => {
  it.each([
    { status: 'SUCCESS' } as const,
    { status: 'FAILURE', code: 'FAKE_FAILURE', message: 'safe failure' } as const,
    { status: 'UNKNOWN', code: 'FAKE_UNKNOWN', message: 'safe uncertainty' } as const
  ])('returns its deterministic configured outcome', async (outcome) => {
    const adapter = FakePrinterAdapter.create('test', outcome)
    await expect(adapter.print(request)).resolves.toEqual(outcome)
  })

  it.each(['staging', 'production'])('cannot be constructed in %s', (environment) => {
    expect(() => FakePrinterAdapter.create(environment, { status: 'SUCCESS' })).toThrow('not allowed')
  })
})

describe('PrintCoordinator', () => {
  it.each([
    [{ status: 'SUCCESS' } as const, 'PRINTED_SUCCESSFULLY'],
    [{ status: 'FAILURE', code: 'FAKE_FAILURE' } as const, 'PRINT_FAILED'],
    [{ status: 'UNKNOWN', code: 'FAKE_UNKNOWN' } as const, 'UNKNOWN']
  ])('maps fake $0 to simulated %s', async (outcome, type) => {
    const record = vi.fn().mockReturnValue(true)
    const coordinator = new PrintCoordinator(FakePrinterAdapter.create('test', outcome), record)
    await expect(coordinator.execute(request)).resolves.toBe(true)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      jobId: request.jobId, attemptId: request.attemptId, type, executionMode: 'SIMULATED'
    }))
  })

  it('calls an adapter exactly once and does not recreate a result for the same attempt', async () => {
    const adapter: PrinterAdapter = { print: vi.fn().mockResolvedValue({ status: 'SUCCESS' }) }
    const record = vi.fn().mockReturnValue(true)
    const coordinator = new PrintCoordinator(adapter, record)
    await coordinator.execute(request)
    await coordinator.execute(request)
    expect(adapter.print).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledOnce()
  })

  it('turns an unexpected fake exception into a simulated UNKNOWN without re-execution', async () => {
    const adapter: PrinterAdapter = { print: vi.fn().mockRejectedValue(new Error('unexpected fake failure')) }
    const record = vi.fn().mockReturnValue(true)
    const coordinator = new PrintCoordinator(adapter, record)
    await coordinator.execute(request)
    await coordinator.execute(request)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UNKNOWN', executionMode: 'SIMULATED', errorCode: 'FAKE_PRINTER_EXCEPTION'
    }))
    expect(adapter.print).toHaveBeenCalledOnce()
  })

  it('uses PF2 persistence before delivery and restart resend does not execute the adapter again', async () => {
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const settings = new MemorySettingsStore()
    settings.activeAssignment = { version: 1, job: { ...request, printType: 'SHIPPING_LABEL', shipmentId: '200000001', orderId: null } }
    const outbox = new MemoryResultOutbox()
    const api = {
      pair: vi.fn(), poll: vi.fn(), acknowledgeReceipt: vi.fn(), recoverCurrentAssignment: vi.fn(),
      submitPrintEvent: vi.fn().mockImplementation(async (_credential, event) => {
        expect(outbox.events).toEqual([event])
        throw new Error('offline')
      })
    }
    const controller = new AgentController(api as unknown as NotiVentaApiClient, credentials, settings, 'DESKTOP-1', outbox)
    await controller.initialize()
    const adapter: PrinterAdapter = { print: vi.fn().mockResolvedValue({ status: 'SUCCESS' }) }
    const coordinator = new PrintCoordinator(adapter, controller.recordPrintResult.bind(controller))

    await controller.executeActiveAssignment(coordinator)
    await vi.waitFor(() => expect(outbox.events).toHaveLength(1))
    const persisted = outbox.events[0]
    expect(persisted).toMatchObject({ type: 'PRINTED_SUCCESSFULLY', executionMode: 'SIMULATED' })
    expect(persisted.type).not.toBe('PRINTING')
    controller.shutdown()

    const restartedApi = {
      pair: vi.fn(), poll: vi.fn(), acknowledgeReceipt: vi.fn(), recoverCurrentAssignment: vi.fn(),
      submitPrintEvent: vi.fn().mockResolvedValue(undefined)
    }
    const restarted = new AgentController(restartedApi as unknown as NotiVentaApiClient, credentials, settings, 'DESKTOP-1', outbox)
    await restarted.initialize()
    expect(restartedApi.submitPrintEvent).toHaveBeenCalledWith('stored-secret', persisted)
    expect(adapter.print).toHaveBeenCalledOnce()
    expect(outbox.events).toEqual([])
    restarted.shutdown()
  })

  it('keeps one adapter call when PF2 retries delivery in the same runtime', async () => {
    vi.useFakeTimers()
    const credentials = new MemoryCredentialStore()
    credentials.credential = 'stored-secret'
    const settings = new MemorySettingsStore()
    settings.activeAssignment = { version: 1, job: { ...request, printType: 'SHIPPING_LABEL', shipmentId: '200000001', orderId: null } }
    const outbox = new MemoryResultOutbox()
    const api = {
      pair: vi.fn(), poll: vi.fn(), acknowledgeReceipt: vi.fn(), recoverCurrentAssignment: vi.fn(),
      submitPrintEvent: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    }
    const controller = new AgentController(api as unknown as NotiVentaApiClient, credentials, settings, 'DESKTOP-1', outbox)
    await controller.initialize()
    const adapter: PrinterAdapter = { print: vi.fn().mockResolvedValue({ status: 'SUCCESS' }) }
    const coordinator = new PrintCoordinator(adapter, controller.recordPrintResult.bind(controller))

    await controller.executeActiveAssignment(coordinator)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.submitPrintEvent).toHaveBeenCalledTimes(2)
    expect(adapter.print).toHaveBeenCalledOnce()
    controller.shutdown()
  })
})
