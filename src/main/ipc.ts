import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts'
import { validateBoolean, validatePairDeviceInput } from '../shared/validation'
import type { AgentController } from './agent-controller'
import type { SettingsStore } from './settings-store'
import type { StartupService } from './startup-service'
import type { PrinterDiscovery } from './printers/printer-discovery'

export function registerAgentIpc(options: {
  ipcMain: IpcMain
  controller: AgentController
  settings: SettingsStore
  startup: StartupService
  printerDiscovery: PrinterDiscovery
  getWindow: () => BrowserWindow | null
}): () => void {
  const { ipcMain, controller, settings, startup, printerDiscovery, getWindow } = options
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
      IPC_CHANNELS.listInstalledPrinters
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
