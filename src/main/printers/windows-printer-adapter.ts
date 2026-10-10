import { isAbsolute } from 'node:path'
import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type WebContentsPrintOptions
} from 'electron'
import type { DiagnosticPrintResult } from '../../shared/contracts'
import type { PrinterReadinessService } from './printer-readiness-service'

export const SHIPPING_LABEL_PAGE_SIZE_MICRONS = {
  width: 101_600,
  height: 152_400
} as const

export const WINDOWS_PRINT_OPTIONS = {
  silent: true,
  printBackground: true,
  color: true,
  margins: { marginType: 'none' },
  landscape: false,
  scaleFactor: 100,
  pagesPerSheet: 1,
  collate: false,
  copies: 1,
  pageSize: SHIPPING_LABEL_PAGE_SIZE_MICRONS
} as const satisfies Omit<WebContentsPrintOptions, 'deviceName'>

export interface WindowsPrintRequest {
  /** An Agent-owned local document. Renderer input must never be passed here directly. */
  documentPath: string
  /**
   * Optional caller-held identity. Physical label work uses this to ensure a
   * configuration change between operator authorization and submission cannot
   * silently redirect a label to another queue.
   */
  expectedPrinterSystemName?: string
}

export type WindowsPrintSubmissionResult = DiagnosticPrintResult

interface PrintWebContents {
  print(
    options: WebContentsPrintOptions,
    callback: (success: boolean, failureReason: string) => void
  ): void
}

interface PrintWindow {
  readonly webContents: PrintWebContents
  loadFile(path: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
}

type PrintWindowFactory = (options: BrowserWindowConstructorOptions) => PrintWindow

export interface WindowsPrinterAdapterDependencies {
  createWindow?: PrintWindowFactory
  platform?: NodeJS.Platform
  submissionTimeoutMs?: number
}

const DEFAULT_SUBMISSION_TIMEOUT_MS = 30_000

/**
 * Submits an Agent-owned local document to one explicitly configured Windows
 * queue. A SUBMITTED result means only that Electron/Windows accepted the
 * request; it is not evidence that physical output occurred.
 */
export class WindowsPrinterAdapter {
  private submissionInProgress = false
  private readonly createWindow: PrintWindowFactory
  private readonly platform: NodeJS.Platform
  private readonly submissionTimeoutMs: number

  constructor(
    private readonly printerReadiness: PrinterReadinessService,
    dependencies: WindowsPrinterAdapterDependencies = {}
  ) {
    this.createWindow = dependencies.createWindow ?? ((options) => new BrowserWindow(options))
    this.platform = dependencies.platform ?? process.platform
    this.submissionTimeoutMs = dependencies.submissionTimeoutMs ?? DEFAULT_SUBMISSION_TIMEOUT_MS
  }

  async print(request: WindowsPrintRequest): Promise<WindowsPrintSubmissionResult> {
    if (this.submissionInProgress) {
      return failed('PRINT_ALREADY_IN_PROGRESS', 'Another print request is already in progress.')
    }
    if (this.platform !== 'win32') {
      return failed('WINDOWS_PRINTING_UNAVAILABLE', 'Windows printing is unavailable on this computer.')
    }
    if (!isAbsolute(request.documentPath)) {
      return failed('PRINT_DOCUMENT_INVALID', 'The local print document is unavailable.')
    }

    this.submissionInProgress = true
    let printWindow: PrintWindow | null = null
    try {
      printWindow = this.createWindow({
        show: false,
        skipTaskbar: true,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          javascript: false,
          webSecurity: true,
          backgroundThrottling: false
        }
      })

      try {
        await printWindow.loadFile(request.documentPath)
      } catch {
        return failed('PRINT_RENDER_FAILED', 'The print document could not be prepared.')
      }

      // Revalidate after rendering, immediately before crossing the Windows
      // print boundary. Never omit deviceName or substitute the OS default.
      let readiness: Awaited<ReturnType<PrinterReadinessService['getReadiness']>>
      try {
        readiness = await this.printerReadiness.getReadiness()
      } catch {
        return failed('PRINTER_NOT_READY', 'The selected printer could not be verified.')
      }
      const systemName = readiness.configuration?.systemName
      if (
        readiness.state !== 'READY' ||
        readiness.ready !== true ||
        typeof systemName !== 'string' ||
        systemName.length === 0
      ) {
        return failed('PRINTER_NOT_READY', 'The selected printer is not currently ready in NotiVenta.')
      }
      if (
        request.expectedPrinterSystemName !== undefined &&
        request.expectedPrinterSystemName !== systemName
      ) {
        return failed('PRINTER_NOT_READY', 'The selected printer changed before Windows submission.')
      }

      return await submitToWindows(
        printWindow.webContents,
        {
          ...WINDOWS_PRINT_OPTIONS,
          deviceName: systemName
        },
        this.submissionTimeoutMs
      )
    } catch {
      return failed('PRINT_RENDER_FAILED', 'The print document could not be prepared.')
    } finally {
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy()
      this.submissionInProgress = false
    }
  }
}

function submitToWindows(
  webContents: PrintWebContents,
  options: WebContentsPrintOptions,
  timeoutMs: number
): Promise<WindowsPrintSubmissionResult> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (result: WindowsPrintSubmissionResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      settle({
        status: 'INDETERMINATE',
        code: 'WINDOWS_PRINT_SUBMISSION_TIMEOUT',
        message: 'Windows did not confirm whether the print request was submitted. Do not retry automatically.'
      })
    }, timeoutMs)

    try {
      webContents.print(options, (success) => {
        if (success) {
          settle({
            status: 'SUBMITTED',
            code: 'SUBMITTED_TO_WINDOWS',
            message: 'Submitted to Windows. Verify that the label printed correctly.'
          })
          return
        }
        settle(failed('WINDOWS_PRINT_REJECTED', 'Windows did not accept the print request.'))
      })
    } catch {
      settle(failed('WINDOWS_PRINT_REJECTED', 'Windows did not accept the print request.'))
    }
  })
}

function failed(
  code: Extract<WindowsPrintSubmissionResult, { status: 'FAILED' }>['code'],
  message: string
): WindowsPrintSubmissionResult {
  return { status: 'FAILED', code, message }
}
