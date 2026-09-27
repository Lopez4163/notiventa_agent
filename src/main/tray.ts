import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { reopenWindow } from './window-lifecycle'

const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAI0lEQVR42mP8z8AARLAAEwMDA8N/BgaG/wwMDAwMjIwoGAAAlf0FDs6L5QAAAABJRU5ErkJggg=='

export function createAgentTray(options: {
  getWindow: () => BrowserWindow | null
  onQuit: () => void
}): Tray {
  const tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL))
  tray.setToolTip('NotiVenta Agent')
  const open = (): void => {
    const window = options.getWindow()
    if (!window) return
    reopenWindow(window)
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open NotiVenta', click: open },
      { type: 'separator' },
      { label: 'Quit', click: options.onQuit }
    ])
  )
  tray.on('double-click', open)
  return tray
}
