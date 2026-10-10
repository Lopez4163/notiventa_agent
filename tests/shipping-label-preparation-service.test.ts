import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { degrees, PDFDocument } from 'pdf-lib'
import {
  ShippingLabelPreparationService,
  type CurrentShippingLabelSource
} from '../src/main/labels/shipping-label-preparation-service'
import type { InMemoryShippingLabel } from '../src/main/labels/shipping-label-download-service'

let temporaryRoot: string

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'notiventa-preparation-test-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('ShippingLabelPreparationService', () => {
  it('prepares one exact 4 x 6 portrait PDF without submitting it to Windows', async () => {
    const bytes = await createPdf([{ width: 288, height: 432 }])
    const source = sourceFor(bytes)
    const windowsPrint = vi.fn()
    let preparedPath: string | null = null

    const result = await new ShippingLabelPreparationService(source, { temporaryRoot })
      .withPreparedCurrentLabel(async (label) => {
        preparedPath = label.documentPath
        expect(label).toMatchObject({
          jobId: '11111111-1111-4111-8111-111111111111',
          attemptId: '22222222-2222-4222-8222-222222222222',
          shipmentId: '200000001',
          orderId: '300000001',
          pageCount: 1,
          geometry: {
            widthInches: 4,
            heightInches: 6,
            orientation: 'PORTRAIT',
            sourceRotationDegrees: 0,
            scale: 1
          }
        })
        const preparedBytes = await readFile(label.documentPath)
        expect(preparedBytes.subarray(0, 5).toString()).toBe('%PDF-')
        return 'prepared'
      })

    expect(result).toBe('prepared')
    expect(windowsPrint).not.toHaveBeenCalled()
    await expectPathMissing(preparedPath)
    expect(bytes.every((value) => value === 0)).toBe(true)
  })

  it('accepts 6 x 4 source geometry only when PDF rotation displays 4 x 6 portrait', async () => {
    const bytes = await createPdf([{ width: 432, height: 288, rotation: 90 }])
    const service = new ShippingLabelPreparationService(sourceFor(bytes), { temporaryRoot })

    await expect(service.withPreparedCurrentLabel((label) => label.geometry))
      .resolves.toEqual({
        widthInches: 4,
        heightInches: 6,
        orientation: 'PORTRAIT',
        sourceRotationDegrees: 90,
        scale: 1
      })
  })

  it('rejects alternate page geometry rather than cropping or scaling it', async () => {
    const bytes = await createPdf([{ width: 612, height: 792 }])
    const consumer = vi.fn()
    const service = new ShippingLabelPreparationService(sourceFor(bytes), { temporaryRoot })

    await expect(service.withPreparedCurrentLabel(consumer)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAGE_GEOMETRY'
    })
    expect(consumer).not.toHaveBeenCalled()
  })

  it('rejects mismatched MediaBox and CropBox instead of silently cropping', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([612, 792])
    page.setCropBox(0, 0, 288, 432)
    const bytes = await document.save()
    const service = new ShippingLabelPreparationService(sourceFor(bytes), { temporaryRoot })

    await expect(service.withPreparedCurrentLabel(() => undefined)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAGE_GEOMETRY'
    })
  })

  it('rejects multi-page PDFs', async () => {
    const bytes = await createPdf([
      { width: 288, height: 432 },
      { width: 288, height: 432 }
    ])
    const service = new ShippingLabelPreparationService(sourceFor(bytes), { temporaryRoot })

    await expect(service.withPreparedCurrentLabel(() => undefined)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAGE_COUNT'
    })
  })

  it('rejects corrupt PDF bytes safely', async () => {
    const bytes = new TextEncoder().encode('%PDF-corrupt document')
    const service = new ShippingLabelPreparationService(sourceFor(bytes), { temporaryRoot })

    await expect(service.withPreparedCurrentLabel(() => undefined)).rejects.toMatchObject({
      code: 'INVALID_PDF_DOCUMENT',
      message: 'The shipping label PDF is malformed or unsupported.'
    })
  })

  it('removes the prepared document when its consumer fails', async () => {
    const bytes = await createPdf([{ width: 288, height: 432 }])
    const service = new ShippingLabelPreparationService(sourceFor(bytes), { temporaryRoot })
    let preparedPath: string | null = null

    await expect(service.withPreparedCurrentLabel((label) => {
      preparedPath = label.documentPath
      throw new Error('later lifecycle step failed')
    })).rejects.toThrow('later lifecycle step failed')

    await expectPathMissing(preparedPath)
  })

  it('expires a stalled preparation lease and removes its document', async () => {
    const bytes = await createPdf([{ width: 288, height: 432 }])
    const service = new ShippingLabelPreparationService(sourceFor(bytes), {
      temporaryRoot,
      leaseTimeoutMs: 5
    })
    let preparedPath: string | null = null

    await expect(service.withPreparedCurrentLabel((label) => {
      preparedPath = label.documentPath
      return new Promise<never>(() => undefined)
    })).rejects.toMatchObject({ code: 'LABEL_PREPARATION_TIMEOUT' })

    await expectPathMissing(preparedPath)
  })
})

function sourceFor(bytes: Uint8Array): CurrentShippingLabelSource {
  return {
    async withCurrentLabel<T>(consumer: (label: InMemoryShippingLabel) => T | Promise<T>): Promise<T> {
      try {
        return await consumer({
          jobId: '11111111-1111-4111-8111-111111111111',
          attemptId: '22222222-2222-4222-8222-222222222222',
          shipmentId: '200000001',
          orderId: '300000001',
          bytes
        })
      } finally {
        bytes.fill(0)
      }
    }
  }
}

async function createPdf(
  pages: Array<{ width: number; height: number; rotation?: 0 | 90 | 180 | 270 }>
): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (const definition of pages) {
    const page = document.addPage([definition.width, definition.height])
    if (definition.rotation !== undefined) page.setRotation(degrees(definition.rotation))
    page.drawText('NotiVenta shipping label fixture', { x: 20, y: 20, size: 8 })
  }
  return document.save()
}

async function expectPathMissing(path: string | null): Promise<void> {
  expect(path).not.toBeNull()
  await expect(access(path as string)).rejects.toMatchObject({ code: 'ENOENT' })
}
