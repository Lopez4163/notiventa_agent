import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type Tray } from 'electron'
import { AgentController } from './agent-controller'
import { NotiVentaApiClient } from './api-client'
import { loadAgentConfig } from './config'
import type { CredentialStore } from './credential-store'
import { registerAgentIpc } from './ipc'
import { detectSystemName, platformIdentifier } from './platform'
import { PACKAGED_AGENT_BUILD_CONFIG } from './packaged-config'
import { ElectronSettingsStore } from './settings-store'
import { SqliteResultOutbox } from './result-outbox'
import { ElectronPrinterDiscovery } from './printers/printer-discovery'
import { StartupService } from './startup-service'
import { createAgentTray } from './tray'
import { createMainWindow } from './window'
import { handleWindowClose } from './window-lifecycle'
import { PRELOAD_OUTPUT_FILENAME } from '../shared/build-artifacts'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let cleanupIpc: (() => void) | null = null
let controller: AgentController | null = null

app.whenReady().then(async () => {
  const platform = platformIdentifier()
  const config = loadAgentConfig({
    version: app.getVersion(),
    platform,
    packaged: app.isPackaged ? PACKAGED_AGENT_BUILD_CONFIG : undefined
  })
  const settings = new ElectronSettingsStore()
  let credentials: CredentialStore
  try {
    const { WindowsCredentialStore } = await import('./credential-store')
    credentials = new WindowsCredentialStore()
    console.info('[credentials] Secure Windows credential storage initialized.')
  } catch {
    console.error('[credentials] Secure Windows credential storage failed to initialize.')
    dialog.showErrorBox(
      'NotiVenta Agent',
      'NotiVenta could not initialize secure Windows credential storage. Close the Agent and contact support.'
    )
    app.quit()
    return
  }
  const startup = new StartupService(app)
  startup.apply(settings.getStartWithWindows())

  controller = new AgentController(
    new NotiVentaApiClient(config),
    credentials,
    settings,
    detectSystemName(),
    new SqliteResultOutbox(join(app.getPath('userData'), 'result-outbox.sqlite'))
  )
  mainWindow = createMainWindow(join(__dirname, `../preload/${PRELOAD_OUTPUT_FILENAME}`), {
    isPackaged: app.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL
  })
  mainWindow.on('close', (event) => {
    if (mainWindow) handleWindowClose(event, mainWindow, quitting)
  })
  cleanupIpc = registerAgentIpc({
    ipcMain,
    controller,
    settings,
    startup,
    printerDiscovery: new ElectronPrinterDiscovery({
      getPrintersAsync: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          throw new Error('Agent window is unavailable for printer discovery.')
        }
        return mainWindow.webContents.getPrintersAsync()
      }
    }),
    getWindow: () => mainWindow
  })
  tray = createAgentTray({
    getWindow: () => mainWindow,
    onQuit: () => {
      quitting = true
      app.quit()
    }
  })
  try {
    await controller.initialize()
  } catch {
    console.error('[credentials] Secure Windows credential storage could not be read during startup.')
    dialog.showErrorBox(
      'NotiVenta Agent',
      'NotiVenta could not restore its secure Device credential. Close the Agent and contact support.'
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  quitting = true
  controller?.shutdown()
  cleanupIpc?.()
  tray?.destroy()
})
