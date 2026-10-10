import { describe, expect, it, vi } from 'vitest'
import {
  ShippingLabelDownloadService,
  ShippingLabelDownloadServiceError,
  type AttemptLabelDownloader
} from '../src/main/labels/shipping-label-download-service'
import type { ReceivedPrintJob } from '../src/shared/contracts'
import { MemoryCredentialStore, MemorySettingsStore } from './test-doubles'

const receivedJob: ReceivedPrintJob = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  printType: 'SHIPPING_LABEL',
  shipmentId: '200000001',
  orderId: '300000001'
}

describe('ShippingLabelDownloadService', () => {
  it('binds authenticated label bytes to the exact durable RECEIVED assignment', async () => {
    const { api, credentials, settings, service } = createService()
    let borrowedBytes: Uint8Array | null = null

    const result = await service.withCurrentLabel((label) => {
      borrowedBytes = label.bytes
      expect(label).toMatchObject({
        jobId: receivedJob.jobId,
        attemptId: receivedJob.attemptId,
        shipmentId: receivedJob.shipmentId,
        orderId: receivedJob.orderId
      })
      expect(new TextDecoder().decode(label.bytes)).toBe('%PDF-1.7\nlabel')
      return 'consumed'
    })

    expect(result).toBe('consumed')
    expect(api.downloadAttemptLabel).toHaveBeenCalledWith('device-secret', receivedJob.attemptId)
    expect(credentials.clearCount).toBe(0)
    expect(settings.activeAssignmentWrites).toEqual([])
    expect(settings.activeAssignmentClearCount).toBe(0)
    expect(Array.from(borrowedBytes ?? [])).toEqual(new Array(14).fill(0))
  })

  it('rejects a changed assignment after download and clears downloaded bytes', async () => {
    const { api, settings, service } = createService()
    const bytes = new TextEncoder().encode('%PDF-1.7\nlabel')
    api.downloadAttemptLabel.mockImplementation(async () => {
      settings.activeAssignment = {
        version: 1,
        job: { ...receivedJob, shipmentId: '200000002' }
      }
      return bytes
    })

    await expect(service.withCurrentLabel(() => undefined)).rejects.toMatchObject({
      code: 'ASSIGNMENT_CHANGED'
    })
    expect(Array.from(bytes)).toEqual(new Array(bytes.byteLength).fill(0))
    expect(settings.activeAssignmentClearCount).toBe(0)
  })

  it('rejects an assignment that changes while credentials are loading before requesting bytes', async () => {
    const { api, credentials, settings, service } = createService()
    credentials.get = vi.fn(async () => {
      settings.activeAssignment = undefined
      return 'device-secret'
    })

    await expect(service.withCurrentLabel(() => undefined)).rejects.toMatchObject({
      code: 'ASSIGNMENT_CHANGED'
    })
    expect(api.downloadAttemptLabel).not.toHaveBeenCalled()
  })

  it('requires a valid durable active assignment', async () => {
    const { api, settings, service } = createService()
    settings.activeAssignment = undefined

    await expect(service.withCurrentLabel(() => undefined)).rejects.toEqual(
      new ShippingLabelDownloadServiceError(
        'No received print assignment is available for label download.',
        'NO_RECEIVED_ASSIGNMENT'
      )
    )
    expect(api.downloadAttemptLabel).not.toHaveBeenCalled()
  })

  it('sanitizes unavailable native credentials without changing the assignment', async () => {
    const { api, credentials, settings, service } = createService()
    credentials.get = vi.fn().mockRejectedValue(new Error('native keyring private detail'))

    await expect(service.withCurrentLabel(() => undefined)).rejects.toMatchObject({
      code: 'DEVICE_CREDENTIAL_UNAVAILABLE',
      message: 'The Device credential is unavailable. Pair this computer again.'
    })
    expect(api.downloadAttemptLabel).not.toHaveBeenCalled()
    expect(settings.getActiveAssignment()).toMatchObject({ kind: 'valid' })
  })

  it('clears borrowed PDF bytes when the consumer fails', async () => {
    const { service } = createService()
    let borrowedBytes: Uint8Array | null = null

    await expect(service.withCurrentLabel((label) => {
      borrowedBytes = label.bytes
      throw new Error('renderer failed')
    })).rejects.toThrow('renderer failed')

    expect(Array.from(borrowedBytes ?? [])).toEqual(new Array(14).fill(0))
  })
})

function createService(): {
  api: { downloadAttemptLabel: ReturnType<typeof vi.fn> }
  credentials: MemoryCredentialStore
  settings: MemorySettingsStore
  service: ShippingLabelDownloadService
} {
  const api = {
    downloadAttemptLabel: vi.fn<AttemptLabelDownloader['downloadAttemptLabel']>()
      .mockResolvedValue(new TextEncoder().encode('%PDF-1.7\nlabel'))
  }
  const credentials = new MemoryCredentialStore()
  credentials.credential = 'device-secret'
  const settings = new MemorySettingsStore()
  settings.activeAssignment = { version: 1, job: receivedJob }
  return {
    api,
    credentials,
    settings,
    service: new ShippingLabelDownloadService(api, credentials, settings)
  }
}
