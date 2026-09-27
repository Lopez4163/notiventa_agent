import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { contentSecurityPolicy } from './content-security-policy'
import { resolveDevelopmentRendererUrl } from './renderer-location'

export function createMainWindow(
  preloadPath: string,
  options: { isPackaged: boolean; rendererUrl?: string }
): BrowserWindow {
  const window = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 380,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())

  const rendererUrl = resolveDevelopmentRendererUrl(options.rendererUrl, options.isPackaged)
  const policy = contentSecurityPolicy(rendererUrl)
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
  if (rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}
