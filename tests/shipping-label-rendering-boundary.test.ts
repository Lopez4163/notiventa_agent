import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShippingLabelPreparationService } from '../src/main/labels/shipping-label-preparation-service'
import { WindowsPrinterAdapter } from '../src/main/printers/windows-printer-adapter'
import type { PrinterReadinessService } from '../src/main/printers/printer-readiness-service'
import { createFourBySixShippingLabelFixture } from './fixtures/four-by-six-shipping-label'

let temporaryRoot: string | null = null

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = null
})

describe('shipping-label PDF rendering boundary', () => {
  it('hands a validated 4 x 6 PDF to Electron unchanged before the Windows boundary', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'notiventa-rendering-boundary-'))
    const fixture = await createFourBySixShippingLabelFixture()
    const loadFile = vi.fn(async (path: string) => {
      const loaded = await readFile(path)
      expect(loaded).toEqual(Buffer.from(fixture))
    })
    const print = vi.fn((_options, callback: (success: boolean, failureReason: string) => void) => callback(true, ''))
    const destroy = vi.fn()
    const adapter = new WindowsPrinterAdapter(
      {
        getReadiness: vi.fn().mockResolvedValue({
          state: 'READY', ready: true, reason: null,
          configuration: { systemName: 'Microsoft Print to PDF', profile: { printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH' } },
          discoveredPrinter: null
        })
      } as unknown as PrinterReadinessService,
      {
        platform: 'win32',
        createWindow: () => ({
          loadFile,
          webContents: { print },
          isDestroyed: () => false,
          destroy
        })
      }
    )
    const preparation = new ShippingLabelPreparationService({
      async withCurrentLabel(consumer) {
        return consumer({
          jobId: '11111111-1111-4111-8111-111111111111',
          attemptId: '22222222-2222-4222-8222-222222222222',
          shipmentId: '200000001',
          orderId: null,
          bytes: fixture
        })
      }
    }, { temporaryRoot })

    await expect(preparation.withPreparedCurrentLabel((label) => adapter.print({
      documentPath: label.documentPath,
      expectedPrinterSystemName: 'Microsoft Print to PDF'
    }))).resolves.toMatchObject({ status: 'SUBMITTED' })

    expect(loadFile).toHaveBeenCalledOnce()
    expect(print).toHaveBeenCalledWith(expect.objectContaining({
      deviceName: 'Microsoft Print to PDF',
      pageSize: { width: 101_600, height: 152_400 },
      scaleFactor: 100,
      margins: { marginType: 'none' }
    }), expect.any(Function))
    expect(destroy).toHaveBeenCalledOnce()
    expect(fixture.every((value) => value === 0)).toBe(false)
  })
})
