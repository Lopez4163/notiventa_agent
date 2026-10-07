import { describe, expect, it } from 'vitest'
import { parsePendingReceipt } from '../src/main/pending-receipt'

const validReceipt = {
  version: 1,
  job: {
    jobId: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    printType: 'SHIPPING_LABEL' as const,
    shipmentId: '200000001',
    orderId: null
  }
}

describe('pending receipt local state', () => {
  it('accepts the minimal versioned safe receipt metadata', () => {
    expect(parsePendingReceipt(validReceipt)).toEqual({
      kind: 'valid',
      receipt: validReceipt
    })
  })

  it.each([
    undefined,
    null
  ])('treats %p as no pending receipt', (value) => {
    expect(parsePendingReceipt(value)).toEqual({ kind: 'none' })
  })

  it.each([
    { version: 2, job: validReceipt.job },
    { version: 1, job: { ...validReceipt.job, attemptId: 'not-a-uuid' } },
    { version: 1, job: { ...validReceipt.job, printType: 'OTHER' } },
    'not-json-state'
  ])('rejects malformed or incompatible persisted receipt state', (value) => {
    expect(parsePendingReceipt(value)).toEqual({ kind: 'invalid' })
  })
})
