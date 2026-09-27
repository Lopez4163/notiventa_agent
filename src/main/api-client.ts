import type {
  BackendOperationalState,
  MercadoLibreStatus,
  SafeDeviceMetadata,
  UpdateStatus
} from '../shared/contracts'
import type { AgentConfig } from './config'

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly temporary: boolean
  ) {
    super(message)
  }
}

export class DefinitiveDeviceAuthenticationError extends BackendError {
  constructor() {
    super('This computer is no longer authorized. Pair it again.', 401, 'DEVICE_UNAUTHORIZED', false)
  }
}

interface PairResponse {
  device: SafeDeviceMetadata & { isPaused: boolean; lastSeenAt: string }
  deviceCredential: string
}

interface PollResponse {
  device: { isPaused: boolean; systemBlocked: boolean }
  mercadoLibre: { status: MercadoLibreStatus }
  queue: { count: number }
  agent: { updateStatus: UpdateStatus }
  job: null
  pollAfterSeconds: number
}

export interface PollResult {
  backend: BackendOperationalState
  pollAfterSeconds: number
}

export class NotiVentaApiClient {
  constructor(
    private readonly config: AgentConfig,
    private readonly request: typeof fetch = fetch
  ) {}

  async pair(input: {
    pairingCode: string
    systemName: string
    displayName: string
  }): Promise<PairResponse> {
    const response = await this.send('/api/v1/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        platform: this.config.platform,
        agentVersion: this.config.version
      })
    })
    return (await response.json()) as PairResponse
  }

  async poll(credential: string): Promise<PollResult> {
    const response = await this.send(
      '/api/v1/agent/poll',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          platform: this.config.platform,
          agentVersion: this.config.version
        })
      },
      true
    )
    const body = (await response.json()) as PollResponse
    return {
      backend: {
        isPaused: body.device.isPaused,
        systemBlocked: body.device.systemBlocked,
        mercadoLibreStatus: body.mercadoLibre.status,
        queueCount: body.queue.count,
        updateStatus: body.agent.updateStatus
      },
      pollAfterSeconds: body.pollAfterSeconds
    }
  }

  private async send(path: string, init: RequestInit, authenticated = false): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await this.request(new URL(path, this.config.backendUrl), {
        ...init,
        signal: controller.signal
      })
      if (response.ok) return response
      if (authenticated && (response.status === 401 || response.status === 403)) {
        throw new DefinitiveDeviceAuthenticationError()
      }
      const errorBody = await safeErrorBody(response)
      throw new BackendError(
        pairingErrorMessage(errorBody.code, response.status),
        response.status,
        errorBody.code,
        response.status >= 500
      )
    } catch (error) {
      if (error instanceof BackendError) throw error
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      throw new BackendError(
        timedOut ? 'NotiVenta took too long to respond.' : 'NotiVenta is temporarily unreachable.',
        null,
        null,
        true
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function safeErrorBody(response: Response): Promise<{ code: string | null }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    return { code: typeof body.error?.code === 'string' ? body.error.code : null }
  } catch {
    return { code: null }
  }
}

function pairingErrorMessage(code: string | null, status: number): string {
  const messages: Record<string, string> = {
    INVALID_PAIRING_CODE: 'That pairing code is not valid.',
    PAIRING_CODE_EXPIRED: 'That pairing code expired. Request a new one.',
    PAIRING_CODE_CONSUMED: 'That pairing code was already used. Request a new one.',
    PAIRING_CODE_INVALIDATED: 'That pairing code is no longer valid. Request a new one.',
    PAIRING_RATE_LIMITED: 'Too many pairing attempts. Try again later.',
    DEVICE_ALREADY_ACTIVE: 'Disconnect the active computer from the dashboard before pairing this one.',
    PAIRING_SERVICE_UNAVAILABLE: 'Pairing is temporarily unavailable.'
  }
  return (code && messages[code]) || (status >= 500 ? 'NotiVenta is temporarily unavailable.' : 'The request could not be completed.')
}
