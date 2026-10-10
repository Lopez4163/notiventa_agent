import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerAgentIpc } from '../src/main/ipc'
import type { AgentController } from '../src/main/agent-controller'
import type { SettingsStore } from '../src/main/settings-store'
import type { StartupService } from '../src/main/startup-service'
import type { PrinterDiscovery } from '../src/main/printers/printer-discovery'
import type { PrinterConfigurationService } from '../src/main/printers/printer-configuration-service'
import type { PrinterReadinessService } from '../src/main/printers/printer-readiness-service'
import { IPC_CHANNELS, type DiagnosticPrintResult, type ShippingLabelPrintResult } from '../src/shared/contracts'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function harness() {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  } as unknown as IpcMain
  const printResult: DiagnosticPrintResult = {
    status: 'SUBMITTED',
    code: 'SUBMITTED_TO_WINDOWS',
    message: 'Submitted to Windows. Verify that the label printed correctly.'
  }
  const printTestLabel = vi.fn().mockResolvedValue(printResult)
  const submitShippingLabel = vi.fn()
  const confirmShippingLabelPrinted = vi.fn()
  const reportShippingLabelPrintFailure = vi.fn()
  const controller = {
    onState: vi.fn().mockReturnValue(() => undefined),
    getState: vi.fn(),
    pair: vi.fn()
  } as unknown as AgentController
  const window = {
    isDestroyed: () => false,
    webContents: { id: 42, send: vi.fn() }
  } as unknown as BrowserWindow
  const cleanup = registerAgentIpc({
    ipcMain,
    controller,
    settings: {} as SettingsStore,
    startup: {} as StartupService,
    printerDiscovery: {} as PrinterDiscovery,
    printerConfiguration: {} as PrinterConfigurationService,
    printerReadiness: {} as PrinterReadinessService,
    printTestLabel,
    submitShippingLabel,
    confirmShippingLabelPrinted,
    reportShippingLabelPrintFailure,
    getWindow: () => window
  })
  const handler = handlers.get(IPC_CHANNELS.printTestLabel)
  if (!handler) throw new Error('Test print handler was not registered.')
  return { handlers, handler, printTestLabel, printResult, submitShippingLabel, confirmShippingLabelPrinted, reportShippingLabelPrintFailure, cleanup, ipcMain }
}

describe('diagnostic test print IPC', () => {
  it('invokes only the fixed Main-owned action and ignores injected renderer values', async () => {
    const { handler, printTestLabel, printResult } = harness()
    const event = { sender: { id: 42 } } as IpcMainInvokeEvent
    await expect(handler(
      event,
      'C:\\attacker\\label.html',
      'Windows Default Printer',
      { copies: 100 }
    )).resolves.toEqual(printResult)
    expect(printTestLabel).toHaveBeenCalledOnce()
    expect(printTestLabel).toHaveBeenCalledWith()
  })

  it('rejects an untrusted sender before reaching the print action', async () => {
    const { handler, printTestLabel } = harness()
    const event = { sender: { id: 99 } } as IpcMainInvokeEvent
    await expect(handler(event)).rejects.toThrow('Untrusted IPC sender.')
    expect(printTestLabel).not.toHaveBeenCalled()
  })

  it('removes the test-print handler during IPC cleanup', () => {
    const { cleanup, ipcMain } = harness()
    cleanup()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.printTestLabel)
  })
})

describe('physical shipping-label IPC', () => {
  it('accepts no renderer-controlled print inputs and requires the trusted Main action', async () => {
    const { handlers, submitShippingLabel } = harness()
    const handler = handlers.get(IPC_CHANNELS.submitShippingLabel)
    if (!handler) throw new Error('Shipping label handler was not registered.')
    const result: ShippingLabelPrintResult = { status: 'BLOCKED', code: 'NO_RECEIVED_ASSIGNMENT', message: 'No received shipping-label assignment is available.' }
    submitShippingLabel.mockResolvedValue(result)
    await expect(handler({ sender: { id: 42 } } as IpcMainInvokeEvent, 'C:\\attacker.pdf', 'Other queue')).resolves.toEqual(result)
    expect(submitShippingLabel).toHaveBeenCalledWith()
  })

  it('keeps terminal confirmation actions trusted and parameter-free', async () => {
    const { handlers, confirmShippingLabelPrinted, reportShippingLabelPrintFailure } = harness()
    const event = { sender: { id: 42 } } as IpcMainInvokeEvent
    const success = { status: 'RECORDED_SUCCESS', message: 'Physical success was saved and will be delivered to NotiVenta.' } satisfies ShippingLabelPrintResult
    const failure = { status: 'RECORDED_FAILURE', message: 'The observed print failure was saved and will be delivered to NotiVenta.' } satisfies ShippingLabelPrintResult
    confirmShippingLabelPrinted.mockReturnValue(success)
    reportShippingLabelPrintFailure.mockReturnValue(failure)
    const successHandler = handlers.get(IPC_CHANNELS.confirmShippingLabelPrinted)
    const failureHandler = handlers.get(IPC_CHANNELS.reportShippingLabelPrintFailure)
    if (!successHandler || !failureHandler) throw new Error('Terminal handlers were not registered.')
    expect(successHandler(event, { type: 'PRINTED_SUCCESSFULLY', attemptId: 'attacker' })).toEqual(success)
    expect(failureHandler(event, { type: 'UNKNOWN', attemptId: 'attacker' })).toEqual(failure)
    expect(confirmShippingLabelPrinted).toHaveBeenCalledWith()
    expect(reportShippingLabelPrintFailure).toHaveBeenCalledWith()
  })
})
