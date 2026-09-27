import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, type Tray } from 'electron'
import { AgentController } from './agent-controller'
import { NotiVentaApiClient } from './api-client'
import { loadAgentConfig } from './config'
import { WindowsCredentialStore } from './credential-store'
import { registerAgentIpc } from './ipc'
import { detectSystemName, platformIdentifier } from './platform'
import { ElectronSettingsStore } from './settings-store'
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
  const config = loadAgentConfig({ version: app.getVersion(), platform })
  const settings = new ElectronSettingsStore()
  const credentials = new WindowsCredentialStore()
  const startup = new StartupService(app)
  startup.apply(settings.getStartWithWindows())

  controller = new AgentController(
    new NotiVentaApiClient(config),
    credentials,
    settings,
    detectSystemName()
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
    getWindow: () => mainWindow
  })
  tray = createAgentTray({
    getWindow: () => mainWindow,
    onQuit: () => {
      quitting = true
      app.quit()
    }
  })
  await controller.initialize()
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  quitting = true
  controller?.shutdown()
  cleanupIpc?.()
  tray?.destroy()
})
