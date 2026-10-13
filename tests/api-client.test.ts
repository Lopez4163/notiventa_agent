import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DefinitiveDeviceAuthenticationError,
  MAX_SHIPPING_LABEL_BYTES,
  NotiVentaApiClient
} from '../src/main/api-client'

const config = {
  backendUrl: new URL('https://dev.example.test'),
  environment: 'development' as const,
  version: '1.0.3',
  platform: 'windows'
}

afterEach(() => vi.useRealTimers())

describe('NotiVenta API client', () => {
  it('sends the exact pairing contract', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      device: { id: 'device-1', systemName: 'DESKTOP-1', displayName: 'Packing', platform: 'windows', agentVersion: '1.0.3', isPaused: false, lastSeenAt: 'now' },
      deviceCredential: 'raw-secret'
    }), { status: 200 }))
    const result = await new NotiVentaApiClient(config, request).pair({
      pairingCode: '482193', systemName: 'DESKTOP-1', displayName: 'Packing'
    })
    const [, init] = request.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      pairingCode: '482193', systemName: 'DESKTOP-1', displayName: 'Packing', platform: 'windows', agentVersion: '1.0.3'
    })
    expect(result.deviceCredential).toBe('raw-secret')
  })

  it('uses Bearer auth and only the Phase 4 poll payload', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      device: { isPaused: false, systemBlocked: false },
      mercadoLibre: { status: 'CONNECTED' }, queue: { count: 2 },
      agent: { updateStatus: 'CURRENT' }, job: null, pollAfterSeconds: 7
    }), { status: 200 }))
    await new NotiVentaApiClient(config, request).poll('device-secret')
    const [, init] = request.mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer device-secret')
    expect(JSON.parse(String(init?.body))).toEqual({ platform: 'windows', agentVersion: '1.0.3' })
  })

  it('accepts a safely received print job without invoking any printer', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      device: { isPaused: false, systemBlocked: false },
      mercadoLibre: { status: 'CONNECTED' }, queue: { count: 0 },
      agent: { updateStatus: 'CURRENT' },
      job: {
        jobId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', printType: 'SHIPPING_LABEL',
        shipmentId: '200000001', orderId: '300000001'
      },
      pollAfterSeconds: 5
    }), { status: 200 }))

    const result = await new NotiVentaApiClient(config, request).poll('device-secret')

    expect(result.job).toEqual({
      jobId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', printType: 'SHIPPING_LABEL',
      shipmentId: '200000001', orderId: '300000001'
    })
  })

  it('acknowledges a validated receipt with the Device credential', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      attemptId: '22222222-2222-4222-8222-222222222222', status: 'RECEIVED', receivedAt: '2026-10-05T00:00:00Z'
    }), { status: 200 }))

    await new NotiVentaApiClient(config, request).acknowledgeReceipt('device-secret', '22222222-2222-4222-8222-222222222222')

    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://dev.example.test/api/v1/agent/attempts/22222222-2222-4222-8222-222222222222/received')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer device-secret')
  })

  it('recovers a current authorized assignment with the Device credential', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      assignment: {
        jobId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', printType: 'SHIPPING_LABEL',
        shipmentId: '200000001', orderId: null
      }
    }), { status: 200 }))

    const assignment = await new NotiVentaApiClient(config, request).recoverCurrentAssignment('device-secret')

    expect(assignment).toEqual({
      jobId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', printType: 'SHIPPING_LABEL',
      shipmentId: '200000001', orderId: null
    })
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://dev.example.test/api/v1/agent/assignment')
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer device-secret')
  })

  it('downloads an authenticated shipping-label PDF for the exact attempt', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nlabel')
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(pdf, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf; charset=binary' }
    }))

    const result = await new NotiVentaApiClient(config, request).downloadAttemptLabel(
      'device-secret',
      '22222222-2222-4222-8222-222222222222'
    )

    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://dev.example.test/api/v1/agent/attempts/22222222-2222-4222-8222-222222222222/label')
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer device-secret')
    expect(result).toEqual(pdf)
  })

  it('rejects a non-PDF content type and cancels its body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull: () => undefined,
      cancel
    })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    }))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('device-secret', 'attempt-1'))
      .rejects.toMatchObject({ code: 'SHIPPING_LABEL_INVALID_CONTENT_TYPE', temporary: false })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects bytes without the PDF signature', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('not a pdf', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' }
    }))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('device-secret', 'attempt-1'))
      .rejects.toMatchObject({ code: 'SHIPPING_LABEL_INVALID_PDF', temporary: false })
  })

  it('rejects an oversized declared label before reading it', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull: () => undefined,
      cancel
    })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(MAX_SHIPPING_LABEL_BYTES + 1)
      }
    }))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('device-secret', 'attempt-1'))
      .rejects.toMatchObject({ code: 'SHIPPING_LABEL_TOO_LARGE', temporary: false })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('enforces the label size limit while streaming and cancels the response', async () => {
    const cancel = vi.fn()
    const signature = new TextEncoder().encode('%PDF-')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(signature)
        controller.enqueue(new Uint8Array(MAX_SHIPPING_LABEL_BYTES))
      },
      cancel
    })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' }
    }))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('device-secret', 'attempt-1'))
      .rejects.toMatchObject({ code: 'SHIPPING_LABEL_TOO_LARGE', temporary: false })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('sanitizes label network failures', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('device-secret private network detail'))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('device-secret', 'attempt-1'))
      .rejects.toMatchObject({
        code: 'SHIPPING_LABEL_DOWNLOAD_FAILED',
        message: 'The shipping label could not be downloaded right now.',
        temporary: true
      })
  })

  it('preserves definitive Device authentication handling for label retrieval', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('revoked', 'attempt-1'))
      .rejects.toBeInstanceOf(DefinitiveDeviceAuthenticationError)
  })

  it('rejects a non-success label status with a safe backend error', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'SHIPPING_LABEL_RETRIEVAL_NOT_ALLOWED', message: 'internal assignment detail' }
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' }
    }))

    await expect(new NotiVentaApiClient(config, request).downloadAttemptLabel('device-secret', 'attempt-1'))
      .rejects.toMatchObject({
        status: 409,
        code: 'SHIPPING_LABEL_RETRIEVAL_NOT_ALLOWED',
        message: 'The shipping label is no longer authorized for this assignment.',
        temporary: false
      })
  })

  it('rejects a malformed recovery response without beginning normal polling', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ assignment: { jobId: 'not-a-uuid' } }), { status: 200 }))

    await expect(new NotiVentaApiClient(config, request).recoverCurrentAssignment('device-secret'))
      .rejects.toMatchObject({ code: 'INVALID_ASSIGNMENT_RECOVERY_RESPONSE', temporary: false })
  })

  it('rejects a malformed received print job safely', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      device: { isPaused: false, systemBlocked: false },
      mercadoLibre: { status: 'CONNECTED' }, queue: { count: 0 },
      agent: { updateStatus: 'CURRENT' },
      job: { jobId: 'job-1' }, pollAfterSeconds: 5
    }), { status: 200 }))

    await expect(new NotiVentaApiClient(config, request).poll('device-secret'))
      .rejects.toMatchObject({ code: 'INVALID_PRINT_JOB_PAYLOAD', temporary: true })
  })

  it('classifies definitive authentication failure separately', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(new NotiVentaApiClient(config, request).poll('revoked')).rejects.toBeInstanceOf(DefinitiveDeviceAuthenticationError)
  })

  it('sends the exact PF1 result-event contract and accepts its acknowledgement', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ acknowledged: true }), { status: 200 }))
    await new NotiVentaApiClient(config, request).submitPrintEvent('device-secret', {
      version: 1, eventId: '33333333-3333-4333-8333-333333333333',
      jobId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222',
      type: 'PRINT_FAILED', executionMode: 'SIMULATED', occurredAt: '2026-10-08T15:00:00Z',
      errorCode: 'TEST_FAILURE', errorMessage: 'safe test message', createdAt: '2026-10-08T15:00:00Z'
    })
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://dev.example.test/api/v1/agent/jobs/11111111-1111-4111-8111-111111111111/events')
    expect(JSON.parse(String(init?.body))).toEqual({
      eventId: '33333333-3333-4333-8333-333333333333', attemptId: '22222222-2222-4222-8222-222222222222',
      type: 'PRINT_FAILED', executionMode: 'SIMULATED', occurredAt: '2026-10-08T15:00:00Z', errorCode: 'TEST_FAILURE', errorMessage: 'safe test message'
    })
  })

  it('keeps a PF1 simulated-event rejection as a permanent delivery error, not credential revocation', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'SIMULATED_PRINT_EVENT_NOT_ALLOWED' } }), { status: 403 }))
    await expect(new NotiVentaApiClient(config, request).submitPrintEvent('device-secret', {
      version: 1, eventId: '33333333-3333-4333-8333-333333333333',
      jobId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222',
      type: 'PRINT_FAILED', executionMode: 'SIMULATED', occurredAt: '2026-10-08T15:00:00Z', errorCode: null, errorMessage: null, createdAt: '2026-10-08T15:00:00Z'
    })).rejects.toMatchObject({ status: 403, code: 'SIMULATED_PRINT_EVENT_NOT_ALLOWED', temporary: false })
  })

  it('returns a user-safe pairing error', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PAIRING_CODE_EXPIRED' } }), { status: 400 }))
    await expect(new NotiVentaApiClient(config, request).pair({ pairingCode: '482193', systemName: 'PC', displayName: 'Packing' })).rejects.toThrow('expired')
  })

  it('aborts requests after ten seconds and classifies the timeout as temporary', async () => {
    vi.useFakeTimers()
    const request = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = new NotiVentaApiClient(config, request).poll('device-secret')
    const assertion = expect(pending).rejects.toMatchObject({ temporary: true })
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })
})
