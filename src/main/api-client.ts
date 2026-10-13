import type {
  BackendOperationalState,
  MercadoLibreStatus,
  ReceivedPrintJob,
  SafeDeviceMetadata,
  UpdateStatus
} from '../shared/contracts'
import type { AgentConfig } from './config'
import type { PendingResultEvent } from './result-outbox'

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

export const MAX_SHIPPING_LABEL_BYTES = 20 * 1024 * 1024

export class ShippingLabelDownloadError extends BackendError {
  constructor(
    message: string,
    code: string,
    temporary: boolean,
    status: number | null = null
  ) {
    super(message, status, code, temporary)
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
  job: ReceivedPrintJob | null
  pollAfterSeconds: number
}

export interface PollResult {
  backend: BackendOperationalState
  job: ReceivedPrintJob | null
  pollAfterSeconds: number
}

interface ReceiptAcknowledgementResponse {
  attemptId: string
  status: 'RECEIVED'
  receivedAt: string
}

interface PrintEventAcknowledgementResponse {
  acknowledged: true
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
      job: parseReceivedJob(body.job),
      pollAfterSeconds: body.pollAfterSeconds
    }
  }

  async acknowledgeReceipt(credential: string, attemptId: string): Promise<void> {
    const response = await this.send(
      `/api/v1/agent/attempts/${encodeURIComponent(attemptId)}/received`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}` }
      },
      true
    )
    const body = (await response.json()) as ReceiptAcknowledgementResponse
    if (body.attemptId !== attemptId || body.status !== 'RECEIVED' || !isNonEmptyString(body.receivedAt)) {
      throw new BackendError('NotiVenta returned an invalid receipt acknowledgement.', 200, 'INVALID_RECEIPT_ACKNOWLEDGEMENT', true)
    }
  }

  async recoverCurrentAssignment(credential: string): Promise<ReceivedPrintJob | null> {
    const response = await this.send(
      '/api/v1/agent/assignment',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${credential}` }
      },
      true
    )
    const body = (await response.json()) as unknown
    try {
      if (!body || typeof body !== 'object' || !('assignment' in body)) {
        throw new Error('Missing assignment')
      }
      return parseReceivedJob(body.assignment)
    } catch {
      throw new BackendError(
        'NotiVenta returned an invalid current assignment.',
        200,
        'INVALID_ASSIGNMENT_RECOVERY_RESPONSE',
        false
      )
    }
  }

  async downloadAttemptLabel(credential: string, attemptId: string): Promise<Uint8Array> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await this.request(
        new URL(`/api/v1/agent/attempts/${encodeURIComponent(attemptId)}/label`, this.config.backendUrl),
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${credential}` },
          signal: controller.signal
        }
      )
      if (!response.ok) await throwResponseError(response, true)
      return await readValidatedPdf(response)
    } catch (error) {
      if (error instanceof BackendError) throw error
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      throw new ShippingLabelDownloadError(
        timedOut
          ? 'The shipping label download took too long.'
          : 'The shipping label could not be downloaded right now.',
        timedOut ? 'SHIPPING_LABEL_DOWNLOAD_TIMEOUT' : 'SHIPPING_LABEL_DOWNLOAD_FAILED',
        true
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async submitPrintEvent(credential: string, event: PendingResultEvent): Promise<void> {
    const response = await this.send(
      `/api/v1/agent/jobs/${encodeURIComponent(event.jobId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventId: event.eventId,
          attemptId: event.attemptId,
          type: event.type,
          executionMode: event.executionMode,
          occurredAt: event.occurredAt,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage
        })
      },
      true
    )
    const body = (await response.json()) as Partial<PrintEventAcknowledgementResponse>
    if (body.acknowledged !== true) {
      throw new BackendError('NotiVenta returned an invalid print-result acknowledgement.', 200, 'INVALID_PRINT_EVENT_ACKNOWLEDGEMENT', true)
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
      return await throwResponseError(response, authenticated)
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

async function readValidatedPdf(response: Response): Promise<Uint8Array> {
  const contentType = response.headers.get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (contentType !== 'application/pdf') {
    await cancelResponseBody(response)
    throw new ShippingLabelDownloadError(
      'NotiVenta returned an invalid shipping-label document.',
      'SHIPPING_LABEL_INVALID_CONTENT_TYPE',
      false,
      response.status
    )
  }

  const declaredLength = parseContentLength(response.headers.get('content-length'))
  if (declaredLength !== null && declaredLength > MAX_SHIPPING_LABEL_BYTES) {
    await cancelResponseBody(response)
    throw labelTooLarge(response.status)
  }
  if (!response.body) {
    throw invalidPdf(response.status)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      totalBytes += value.byteLength
      if (totalBytes > MAX_SHIPPING_LABEL_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw labelTooLarge(response.status)
      }
      chunks.push(value.slice())
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
      chunk.fill(0)
    }
    chunks.length = 0

    if (!hasPdfSignature(bytes)) {
      bytes.fill(0)
      throw invalidPdf(response.status)
    }
    return bytes
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0)
    if (error instanceof BackendError) throw error
    await reader.cancel().catch(() => undefined)
    throw new ShippingLabelDownloadError(
      'The shipping label download was interrupted.',
      'SHIPPING_LABEL_DOWNLOAD_INTERRUPTED',
      true,
      response.status
    )
  } finally {
    reader.releaseLock()
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
}

function labelTooLarge(status: number): ShippingLabelDownloadError {
  return new ShippingLabelDownloadError(
    'The shipping label is too large to process safely.',
    'SHIPPING_LABEL_TOO_LARGE',
    false,
    status
  )
}

function invalidPdf(status: number): ShippingLabelDownloadError {
  return new ShippingLabelDownloadError(
    'NotiVenta returned an invalid shipping-label document.',
    'SHIPPING_LABEL_INVALID_PDF',
    false,
    status
  )
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function parseReceivedJob(value: unknown): ReceivedPrintJob | null {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw invalidPrintJobPayload()
  const job = value as Record<string, unknown>
  if (
    !isUuid(job.jobId) ||
    !isUuid(job.attemptId) ||
    job.printType !== 'SHIPPING_LABEL' ||
    !isNonEmptyString(job.shipmentId) ||
    (job.orderId !== null && !isNonEmptyString(job.orderId))
  ) {
    throw invalidPrintJobPayload()
  }
  return {
    jobId: job.jobId,
    attemptId: job.attemptId,
    printType: job.printType,
    shipmentId: job.shipmentId,
    orderId: job.orderId
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function invalidPrintJobPayload(): BackendError {
  return new BackendError('NotiVenta returned an invalid print job.', 200, 'INVALID_PRINT_JOB_PAYLOAD', true)
}

async function safeErrorBody(response: Response): Promise<{ code: string | null }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    return { code: typeof body.error?.code === 'string' ? body.error.code : null }
  } catch {
    return { code: null }
  }
}

async function throwResponseError(response: Response, authenticated: boolean): Promise<never> {
  const errorBody = await safeErrorBody(response)
  if (authenticated && (response.status === 401 || errorBody.code === 'DEVICE_UNAUTHORIZED')) {
    throw new DefinitiveDeviceAuthenticationError()
  }
  throw new BackendError(
    requestErrorMessage(errorBody.code, response.status),
    response.status,
    errorBody.code,
    response.status >= 500
  )
}

function requestErrorMessage(code: string | null, status: number): string {
  const messages: Record<string, string> = {
    INVALID_PAIRING_CODE: 'That pairing code is not valid.',
    PAIRING_CODE_EXPIRED: 'That pairing code expired. Request a new one.',
    PAIRING_CODE_CONSUMED: 'That pairing code was already used. Request a new one.',
    PAIRING_CODE_INVALIDATED: 'That pairing code is no longer valid. Request a new one.',
    PAIRING_RATE_LIMITED: 'Too many pairing attempts. Try again later.',
    DEVICE_ALREADY_ACTIVE: 'Disconnect the active computer from the dashboard before pairing this one.',
    PAIRING_SERVICE_UNAVAILABLE: 'Pairing is temporarily unavailable.',
    PRINT_ATTEMPT_NOT_FOUND: 'The current print assignment is no longer available.',
    SHIPPING_LABEL_RETRIEVAL_NOT_ALLOWED: 'The shipping label is no longer authorized for this assignment.',
    SHIPPING_LABEL_NOT_READY: 'The shipping label is not ready yet.',
    SHIPPING_LABEL_UNSUPPORTED: 'This shipment does not provide a printable shipping label.',
    SHIPPING_LABEL_NOT_FOUND: 'The shipping label could not be found.',
    MERCADO_LIBRE_CONNECTION_REQUIRED: 'Reconnect Mercado Libre before retrieving the shipping label.',
    SHIPPING_LABEL_PROVIDER_UNAVAILABLE: 'The shipping label provider is temporarily unavailable.',
    SHIPPING_LABEL_INVALID_RESPONSE: 'The shipping label provider returned an invalid document.'
  }
  return (code && messages[code]) || (status >= 500 ? 'NotiVenta is temporarily unavailable.' : 'The request could not be completed.')
}
