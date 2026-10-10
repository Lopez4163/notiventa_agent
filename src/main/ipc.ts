import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts'
import { validateBoolean, validatePairDeviceInput } from '../shared/validation'
import type { AgentController } from './agent-controller'
import type { SettingsStore } from './settings-store'
import type { StartupService } from './startup-service'
import type { PrinterDiscovery } from './printers/printer-discovery'
import type { PrinterConfigurationService } from './printers/printer-configuration-service'
import type { PrinterReadinessService } from './printers/printer-readiness-service'
import type { DiagnosticPrintResult, ShippingLabelPrintResult } from '../shared/contracts'

export function registerAgentIpc(options: {
  ipcMain: IpcMain
  controller: AgentController
  settings: SettingsStore
  startup: StartupService
  printerDiscovery: PrinterDiscovery
  printerConfiguration: PrinterConfigurationService
  printerReadiness: PrinterReadinessService
  printTestLabel: () => Promise<DiagnosticPrintResult>
  submitShippingLabel: () => Promise<ShippingLabelPrintResult>
  confirmShippingLabelPrinted: () => ShippingLabelPrintResult
  reportShippingLabelPrintFailure: () => ShippingLabelPrintResult
  getWindow: () => BrowserWindow | null
}): () => void {
  const {
    ipcMain, controller, settings, startup, printerDiscovery, printerConfiguration,
    printerReadiness, printTestLabel, submitShippingLabel, confirmShippingLabelPrinted,
    reportShippingLabelPrintFailure, getWindow
  } = options
  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    const window = getWindow()
    if (!window || event.sender.id !== window.webContents.id) {
      throw new Error('Untrusted IPC sender.')
    }
  }

  ipcMain.handle(IPC_CHANNELS.getState, (event) => {
    assertTrustedSender(event)
    return controller.getState()
  })
  ipcMain.handle(IPC_CHANNELS.pairDevice, async (event, input: unknown) => {
    assertTrustedSender(event)
    return controller.pair(validatePairDeviceInput(input))
  })
  ipcMain.handle(IPC_CHANNELS.getStartWithWindows, (event) => {
    assertTrustedSender(event)
    return settings.getStartWithWindows()
  })
  ipcMain.handle(IPC_CHANNELS.setStartWithWindows, (event, input: unknown) => {
    assertTrustedSender(event)
    const enabled = validateBoolean(input)
    settings.setStartWithWindows(enabled)
    startup.apply(enabled)
    return enabled
  })
  ipcMain.handle(IPC_CHANNELS.listInstalledPrinters, async (event) => {
    assertTrustedSender(event)
    return printerDiscovery.listPrinters()
  })
  ipcMain.handle(IPC_CHANNELS.getPrinterConfiguration, async (event) => {
    assertTrustedSender(event)
    return printerConfiguration.getStatus()
  })
  ipcMain.handle(IPC_CHANNELS.getPrinterReadiness, async (event) => {
    assertTrustedSender(event)
    return printerReadiness.getReadiness()
  })
  ipcMain.handle(IPC_CHANNELS.selectPrinter, async (event, systemName: unknown) => {
    assertTrustedSender(event)
    return printerConfiguration.select(typeof systemName === 'string' ? systemName : '')
  })
  ipcMain.handle(IPC_CHANNELS.clearPrinterConfiguration, async (event) => {
    assertTrustedSender(event)
    return printerConfiguration.clear()
  })
  ipcMain.handle(IPC_CHANNELS.printTestLabel, async (event) => {
    assertTrustedSender(event)
    return printTestLabel()
  })
  ipcMain.handle(IPC_CHANNELS.submitShippingLabel, async (event) => {
    assertTrustedSender(event)
    return submitShippingLabel()
  })
  ipcMain.handle(IPC_CHANNELS.confirmShippingLabelPrinted, (event) => {
    assertTrustedSender(event)
    return confirmShippingLabelPrinted()
  })
  ipcMain.handle(IPC_CHANNELS.reportShippingLabelPrintFailure, (event) => {
    assertTrustedSender(event)
    return reportShippingLabelPrintFailure()
  })

  const unsubscribe = controller.onState((state) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.stateChanged, state)
    }
  })

  return () => {
    unsubscribe()
    for (const channel of [
      IPC_CHANNELS.getState,
      IPC_CHANNELS.pairDevice,
      IPC_CHANNELS.getStartWithWindows,
      IPC_CHANNELS.setStartWithWindows,
      IPC_CHANNELS.listInstalledPrinters,
      IPC_CHANNELS.getPrinterConfiguration,
      IPC_CHANNELS.getPrinterReadiness,
      IPC_CHANNELS.selectPrinter,
      IPC_CHANNELS.clearPrinterConfiguration,
      IPC_CHANNELS.printTestLabel,
      IPC_CHANNELS.submitShippingLabel,
      IPC_CHANNELS.confirmShippingLabelPrinted,
      IPC_CHANNELS.reportShippingLabelPrintFailure
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
