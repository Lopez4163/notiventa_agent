import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentController } from '../src/main/agent-controller'
import { NotiVentaApiClient } from '../src/main/api-client'
import { FakePrinterAdapter } from '../src/main/printers/fake-printer-adapter'
import { PrintCoordinator } from '../src/main/printing/print-coordinator'
import { MemoryCredentialStore, MemoryResultOutbox, MemorySettingsStore } from './test-doubles'

const job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  printType: 'SHIPPING_LABEL' as const,
  shipmentId: '200000001',
  orderId: null
}

const config = {
  backendUrl: new URL('http://127.0.0.1:9999'),
  environment: 'development' as const,
  version: 'test',
  platform: 'windows'
}

afterEach(() => vi.restoreAllMocks())

function createController(request: typeof fetch, outbox = new MemoryResultOutbox()) {
  const credentials = new MemoryCredentialStore()
  credentials.credential = 'local-test-device-credential'
  const settings = new MemorySettingsStore()
  settings.activeAssignment = { version: 1, job }
  const controller = new AgentController(
    new NotiVentaApiClient(config, request), credentials, settings, 'PF4-LOCAL', outbox
  )
  return { controller, credentials, settings, outbox }
}

function acknowledgedBackend(requests: Array<{ url: string; body: unknown }>): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url.endsWith('/events')) return new Response(JSON.stringify({ acknowledged: true }), { status: 200 })
    if (url.endsWith('/assignment')) return new Response(JSON.stringify({ assignment: null }), { status: 200 })
    return new Response(JSON.stringify({
      device: { isPaused: false, systemBlocked: false }, mercadoLibre: { status: 'CONNECTED' },
      queue: { count: 0 }, agent: { updateStatus: 'CURRENT' }, job: null, pollAfterSeconds: 60
    }), { status: 200 })
  })
}

describe('PF4 fake lifecycle through PF2 and the PF1 HTTP contract', () => {
  it.each([
    [{ status: 'SUCCESS' } as const, 'PRINTED_SUCCESSFULLY'],
    [{ status: 'FAILURE', code: 'FAKE_FAILURE' } as const, 'PRINT_FAILED'],
    [{ status: 'UNKNOWN', code: 'FAKE_UNKNOWN' } as const, 'UNKNOWN']
  ])('persists and delivers simulated %s exactly once', async (outcome, expectedType) => {
    const requests: Array<{ url: string; body: unknown }> = []
    const created = createController(acknowledgedBackend(requests))
    await created.controller.initialize()
    const adapter = FakePrinterAdapter.create('test', outcome)
    const adapterPrint = vi.spyOn(adapter, 'print')
    const coordinator = new PrintCoordinator(adapter, created.controller.recordPrintResult.bind(created.controller))

    await expect(created.controller.executeActiveAssignment(coordinator)).resolves.toBe(true)
    await vi.waitFor(() => expect(requests.filter((request) => request.url.endsWith('/events'))).toHaveLength(1))

    const event = requests.find((request) => request.url.endsWith('/events'))?.body as Record<string, unknown>
    expect(adapterPrint).toHaveBeenCalledOnce()
    expect(event).toMatchObject({ attemptId: job.attemptId, type: expectedType, executionMode: 'SIMULATED' })
    expect(event.type).not.toBe('PRINTING')
    expect(created.outbox.events).toEqual([])
    expect(created.settings.getActiveAssignment()).toEqual({ kind: 'none' })
    created.controller.shutdown()
  })

  it('retains one result after transport failure, then restart resends the same event without fake re-execution', async () => {
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const first = createController(unavailable)
    await first.controller.initialize()
    const adapter = FakePrinterAdapter.create('test', { status: 'SUCCESS' })
    const adapterPrint = vi.spyOn(adapter, 'print')
    const coordinator = new PrintCoordinator(adapter, first.controller.recordPrintResult.bind(first.controller))

    await first.controller.executeActiveAssignment(coordinator)
    await vi.waitFor(() => expect(first.outbox.events).toHaveLength(1))
    const saved = structuredClone(first.outbox.events[0])
    first.controller.shutdown()

    const requests: Array<{ url: string; body: unknown }> = []
    const restarted = new AgentController(
      new NotiVentaApiClient(config, acknowledgedBackend(requests)), first.credentials, first.settings,
      'PF4-LOCAL', first.outbox
    )
    await restarted.initialize()
    await vi.waitFor(() => expect(requests.filter((request) => request.url.endsWith('/events'))).toHaveLength(1))
    expect(requests.find((request) => request.url.endsWith('/events'))?.body).toMatchObject({ eventId: saved.eventId })
    expect(first.outbox.events).toEqual([])
    expect(adapterPrint).toHaveBeenCalledOnce()
    restarted.shutdown()
  })

  it('resends the same event after a lost ACK without a second fake execution', async () => {
    const acceptedEventIds: string[] = []
    let loseFirstAcknowledgement = true
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/events')) {
        const event = JSON.parse(String(init?.body)) as { eventId: string }
        if (!acceptedEventIds.includes(event.eventId)) acceptedEventIds.push(event.eventId)
        if (loseFirstAcknowledgement) {
          loseFirstAcknowledgement = false
          throw new Error('backend committed, acknowledgement lost')
        }
        return new Response(JSON.stringify({ acknowledged: true }), { status: 200 })
      }
      if (url.endsWith('/assignment')) return new Response(JSON.stringify({ assignment: null }), { status: 200 })
      return new Response(JSON.stringify({
        device: { isPaused: false, systemBlocked: false }, mercadoLibre: { status: 'CONNECTED' },
        queue: { count: 0 }, agent: { updateStatus: 'CURRENT' }, job: null, pollAfterSeconds: 60
      }), { status: 200 })
    })
    const first = createController(request)
    await first.controller.initialize()
    const adapter = FakePrinterAdapter.create('test', { status: 'UNKNOWN', code: 'FAKE_UNKNOWN' })
    const adapterPrint = vi.spyOn(adapter, 'print')
    const coordinator = new PrintCoordinator(adapter, first.controller.recordPrintResult.bind(first.controller))
    await first.controller.executeActiveAssignment(coordinator)
    await vi.waitFor(() => expect(first.outbox.events).toHaveLength(1))
    const eventId = first.outbox.events[0].eventId
    first.controller.shutdown()

    const restarted = new AgentController(
      new NotiVentaApiClient(config, request), first.credentials, first.settings, 'PF4-LOCAL', first.outbox
    )
    await restarted.initialize()
    await vi.waitFor(() => expect(first.outbox.events).toEqual([]))
    expect(acceptedEventIds).toEqual([eventId])
    expect(adapterPrint).toHaveBeenCalledOnce()
    restarted.shutdown()
  })
})
