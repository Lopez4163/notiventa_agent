import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefinitiveDeviceAuthenticationError, NotiVentaApiClient } from '../src/main/api-client'

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
