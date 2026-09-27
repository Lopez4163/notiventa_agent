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
