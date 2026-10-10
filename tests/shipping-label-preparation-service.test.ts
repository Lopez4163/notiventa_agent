import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
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
  it('prepares a nonblank, exact 4 x 6 raster print document without submitting it to Windows', async () => {
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
        expect(label.documentPath).toMatch(/shipping-label\.html$/)
        const preparedHtml = await readFile(label.documentPath, 'utf8')
        expect(preparedHtml).toContain('@page { size: 4in 6in; margin: 0; }')
        expect(preparedHtml).toContain('src="shipping-label.png"')

        const preparedPng = await readFile(join(dirname(label.documentPath), 'shipping-label.png'))
        expect(preparedPng.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const image = await loadImage(preparedPng)
        expect(image.width).toBe(1200)
        expect(image.height).toBe(1800)
        const canvas = createCanvas(image.width, image.height)
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        expect(hasDarkPixel(pixels)).toBe(true)
        expect(hasLightPixel(pixels)).toBe(true)
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

  it('does not expose a print document when raster rendering fails', async () => {
    const bytes = await createPdf([{ width: 288, height: 432 }])
    const consumer = vi.fn()
    const service = new ShippingLabelPreparationService(sourceFor(bytes), {
      temporaryRoot,
      rasterize: async () => { throw new Error('fixture rendering failure') }
    })

    await expect(service.withPreparedCurrentLabel(consumer)).rejects.toMatchObject({
      code: 'LABEL_RENDERING_FAILED'
    })
    expect(consumer).not.toHaveBeenCalled()
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

function hasDarkPixel(pixels: Uint8ClampedArray): boolean {
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 32 && pixels[index + 1] < 32 && pixels[index + 2] < 32) return true
  }
  return false
}

function hasLightPixel(pixels: Uint8ClampedArray): boolean {
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] > 240 && pixels[index + 1] > 240 && pixels[index + 2] > 240) return true
  }
  return false
}
