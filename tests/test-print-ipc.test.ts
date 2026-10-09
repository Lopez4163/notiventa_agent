import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerAgentIpc } from '../src/main/ipc'
import type { AgentController } from '../src/main/agent-controller'
import type { SettingsStore } from '../src/main/settings-store'
import type { StartupService } from '../src/main/startup-service'
import type { PrinterDiscovery } from '../src/main/printers/printer-discovery'
import type { PrinterConfigurationService } from '../src/main/printers/printer-configuration-service'
import type { PrinterReadinessService } from '../src/main/printers/printer-readiness-service'
import { IPC_CHANNELS, type DiagnosticPrintResult } from '../src/shared/contracts'

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
    getWindow: () => window
  })
  const handler = handlers.get(IPC_CHANNELS.printTestLabel)
  if (!handler) throw new Error('Test print handler was not registered.')
  return { handler, printTestLabel, printResult, cleanup, ipcMain }
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
