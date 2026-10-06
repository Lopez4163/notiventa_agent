import type { ReceivedPrintJob } from '../shared/contracts'

export interface PendingReceipt {
  version: 1
  job: ReceivedPrintJob
}

export type PendingReceiptLoadResult =
  | { kind: 'none' }
  | { kind: 'valid'; receipt: PendingReceipt }
  | { kind: 'invalid' }

export function parsePendingReceipt(value: unknown): PendingReceiptLoadResult {
  if (value === undefined || value === null) return { kind: 'none' }
  if (!value || typeof value !== 'object') return { kind: 'invalid' }

  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || !isReceivedPrintJob(candidate.job)) {
    return { kind: 'invalid' }
  }

  return {
    kind: 'valid',
    receipt: {
      version: 1,
      job: candidate.job
    }
  }
}

function isReceivedPrintJob(value: unknown): value is ReceivedPrintJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Record<string, unknown>
  return (
    isUuid(job.jobId) &&
    isUuid(job.attemptId) &&
    job.printType === 'SHIPPING_LABEL' &&
    isNonEmptyString(job.shipmentId) &&
    (job.orderId === null || isNonEmptyString(job.orderId))
  )
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
