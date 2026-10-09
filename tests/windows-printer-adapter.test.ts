import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContentsPrintOptions } from 'electron'
import { WindowsPrinterAdapter } from '../src/main/printers/windows-printer-adapter'
import type { PrinterReadinessService } from '../src/main/printers/printer-readiness-service'

// The adapter is exercised on non-Windows CI with an injected win32 platform,
// so use a host-absolute path while still proving it is passed through exactly.
const documentPath = '/agent/resources/diagnostic-label.html'
const ready = {
  state: 'READY',
  ready: true,
  reason: null,
  configuration: {
    systemName: 'WHTP203e Exact Queue',
    profile: { printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH' }
  },
  discoveredPrinter: {
    systemName: 'WHTP203e Exact Queue',
    displayName: 'WHTP203e',
    description: null,
    isDefault: false,
    available: true
  }
} as const

function harness(options: {
  readiness?: object
  loadFailure?: boolean
  printImplementation?: (
    options: WebContentsPrintOptions,
    callback: (success: boolean, failureReason: string) => void
  ) => void
  timeoutMs?: number
} = {}) {
  const getReadiness = vi.fn().mockResolvedValue(options.readiness ?? ready)
  const loadFile = options.loadFailure
    ? vi.fn().mockRejectedValue(new Error('native renderer detail'))
    : vi.fn().mockResolvedValue(undefined)
  const print = vi.fn(options.printImplementation ?? ((_settings, callback) => callback(true, '')))
  const destroy = vi.fn()
  const printWindow = { webContents: { print }, loadFile, isDestroyed: vi.fn(() => false), destroy }
  const createWindow = vi.fn(() => printWindow)
  const adapter = new WindowsPrinterAdapter(
    { getReadiness } as unknown as PrinterReadinessService,
    { createWindow, platform: 'win32', submissionTimeoutMs: options.timeoutMs ?? 1_000 }
  )
  return { adapter, getReadiness, createWindow, printWindow, loadFile, print, destroy }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WindowsPrinterAdapter', () => {
  it('targets only the exact persisted queue with fixed 4 x 6 portrait options', async () => {
    const { adapter, createWindow, loadFile, print, destroy } = harness()

    await expect(adapter.print({ documentPath })).resolves.toEqual({
      status: 'SUBMITTED',
      code: 'SUBMITTED_TO_WINDOWS',
      message: 'Submitted to Windows. Verify that the label printed correctly.'
    })

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      skipTaskbar: true,
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false
      })
    }))
    expect(loadFile).toHaveBeenCalledWith(documentPath)
    expect(print).toHaveBeenCalledWith({
      silent: true,
      printBackground: true,
      color: true,
      margins: { marginType: 'none' },
      landscape: false,
      scaleFactor: 100,
      pagesPerSheet: 1,
      collate: false,
      copies: 1,
      pageSize: { width: 101_600, height: 152_400 },
      deviceName: 'WHTP203e Exact Queue'
    }, expect.any(Function))
    expect(destroy).toHaveBeenCalledOnce()
  })

  it.each([
    ['NOT_CONFIGURED', false, null],
    ['UNAVAILABLE', false, { systemName: 'Remembered Queue' }]
  ])('fails closed when readiness is %s and never calls Windows print', async (state, isReady, configuration) => {
    const { adapter, print, destroy } = harness({
      readiness: { state, ready: isReady, reason: 'CONFIGURED_PRINTER_UNAVAILABLE', configuration, discoveredPrinter: null }
    })
    await expect(adapter.print({ documentPath })).resolves.toMatchObject({
      status: 'FAILED', code: 'PRINTER_NOT_READY'
    })
    expect(print).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('fails closed when readiness cannot be verified', async () => {
    const getReadiness = vi.fn().mockRejectedValue(new Error('native discovery detail'))
    const print = vi.fn()
    const destroy = vi.fn()
    const adapter = new WindowsPrinterAdapter(
      { getReadiness } as unknown as PrinterReadinessService,
      {
        platform: 'win32',
        createWindow: () => ({
          loadFile: vi.fn().mockResolvedValue(undefined),
          webContents: { print },
          isDestroyed: () => false,
          destroy
        })
      }
    )
    await expect(adapter.print({ documentPath })).resolves.toEqual({
      status: 'FAILED', code: 'PRINTER_NOT_READY', message: 'The selected printer could not be verified.'
    })
    expect(print).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('prevents concurrent submissions without creating another window', async () => {
    let completePrint: ((success: boolean, failureReason: string) => void) | undefined
    const { adapter, createWindow } = harness({
      printImplementation: (_settings, callback) => { completePrint = callback }
    })

    const first = adapter.print({ documentPath })
    await vi.waitFor(() => expect(completePrint).toBeTypeOf('function'))
    await expect(adapter.print({ documentPath })).resolves.toMatchObject({
      status: 'FAILED', code: 'PRINT_ALREADY_IN_PROGRESS'
    })
    expect(createWindow).toHaveBeenCalledOnce()
    completePrint?.(true, '')
    await expect(first).resolves.toMatchObject({ status: 'SUBMITTED' })
  })

  it('returns a safe failure and cleans up when rendering fails', async () => {
    const { adapter, getReadiness, print, destroy } = harness({ loadFailure: true })
    await expect(adapter.print({ documentPath })).resolves.toEqual({
      status: 'FAILED', code: 'PRINT_RENDER_FAILED', message: 'The print document could not be prepared.'
    })
    expect(getReadiness).not.toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('returns a safe failure and cleans up when Windows rejects submission', async () => {
    const { adapter, destroy } = harness({
      printImplementation: (_settings, callback) => callback(false, 'native spooler detail')
    })
    await expect(adapter.print({ documentPath })).resolves.toEqual({
      status: 'FAILED', code: 'WINDOWS_PRINT_REJECTED', message: 'Windows did not accept the print request.'
    })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('returns indeterminate on timeout, cleans up, and ignores a late callback', async () => {
    vi.useFakeTimers()
    let completePrint: ((success: boolean, failureReason: string) => void) | undefined
    const { adapter, destroy } = harness({
      timeoutMs: 50,
      printImplementation: (_settings, callback) => { completePrint = callback }
    })
    const result = adapter.print({ documentPath })
    await vi.advanceTimersByTimeAsync(50)
    await expect(result).resolves.toEqual({
      status: 'INDETERMINATE',
      code: 'WINDOWS_PRINT_SUBMISSION_TIMEOUT',
      message: 'Windows did not confirm whether the print request was submitted. Do not retry automatically.'
    })
    expect(destroy).toHaveBeenCalledOnce()
    completePrint?.(true, '')
  })

  it('does not create a window for a non-Windows platform or non-absolute document', async () => {
    const { getReadiness } = harness()
    const createWindow = vi.fn()
    const nonWindows = new WindowsPrinterAdapter(
      { getReadiness } as unknown as PrinterReadinessService,
      { createWindow, platform: 'darwin' }
    )
    await expect(nonWindows.print({ documentPath })).resolves.toMatchObject({
      status: 'FAILED', code: 'WINDOWS_PRINTING_UNAVAILABLE'
    })
    const windows = new WindowsPrinterAdapter(
      { getReadiness } as unknown as PrinterReadinessService,
      { createWindow, platform: 'win32' }
    )
    await expect(windows.print({ documentPath: 'relative.html' })).resolves.toMatchObject({
      status: 'FAILED', code: 'PRINT_DOCUMENT_INVALID'
    })
    expect(createWindow).not.toHaveBeenCalled()
  })
})
